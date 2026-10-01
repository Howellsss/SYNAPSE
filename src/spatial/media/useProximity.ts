import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RemoteTrack, RemoteTrackPublication, Room } from 'livekit-client';
import type { RemoteStore } from '@/spatial/net/useSpaceChannel';
import type { PresenceMeta } from '@/spatial/net/protocol';
import type { SpaceRoom } from '@/types';
import { computeProximity, RECONCILE_MS, zoneRule, type Group, type Link, type ProxPerson, type ProximityState, type ZoneRule } from './proximity';

export interface InRangePerson {
  id: string;
  link: Link;
  /** We're receiving their camera. */
  video: boolean;
}

export interface ProximityView {
  /** People I hear (and maybe see), nearest first. */
  inRange: InRangePerson[];
  /** My conversation group (excluding me). */
  myGroup: string[];
  /** Everyone's groups, with floor circles for the scene. */
  groups: Group[];
  /** Run now (e.g. right after a position change). */
  reconcile: () => void;
}

interface Options {
  room: Room | null;
  meId: string | null;
  /** My position in tiles, or null until the scene places me. */
  myPos: { x: number; z: number } | null;
  myZone: string | null;
  people: PresenceMeta[];
  remotes: RemoteStore;
  rooms: SpaceRoom[];
  dataSaver: boolean;
}

/** Stable text form of what the UI shows, so 500 ms ticks only re-render when something changed. */
const signature = (v: { inRange: InRangePerson[]; myGroup: string[]; groups: Group[] }) =>
  JSON.stringify([
    v.inRange.map((p) => [p.id, p.link.reason, Math.round(p.link.volume * 10), p.video]),
    v.myGroup,
    v.groups.map((g) => [g.ids, g.circle && [Math.round(g.circle.x * 2), Math.round(g.circle.z * 2), Math.round(g.circle.r * 2)]]),
  ]);

/**
 * Proximity conversations: decides who you hear and see, subscribes to exactly those LiveKit
 * tracks (and unsubscribes from everyone else), sets per-person volume, and plays the audio.
 */
export function useProximity({ room, meId, myPos, myZone, people, remotes, rooms, dataSaver }: Options): ProximityView {
  const [view, setView] = useState<{ inRange: InRangePerson[]; myGroup: string[]; groups: Group[] }>({ inRange: [], myGroup: [], groups: [] });
  const state = useRef<ProximityState | null>(null);
  const sig = useRef('');
  const zones = useMemo(() => new Map<string, ZoneRule>(rooms.map((r) => [r.id, zoneRule(r.type)])), [rooms]);
  const latest = useRef({ room, meId, myPos, myZone, people, zones, dataSaver });
  latest.current = { room, meId, myPos, myZone, people, zones, dataSaver };

  const reconcile = useCallback(() => {
    const { room: r, meId: me, myPos: pos, myZone: zone, people: ps, zones: zs, dataSaver: saver } = latest.current;
    if (!me) return;
    const now = performance.now();
    const list: ProxPerson[] = ps.map((p) => {
      if (p.userId === me) return { id: me, pos, zoneId: zone };
      const pose = remotes.pose(p.userId, now);
      return { id: p.userId, pos: pose ? { x: pose.x, z: pose.z } : null, zoneId: p.zoneId };
    });
    if (!list.some((p) => p.id === me)) list.push({ id: me, pos, zoneId: zone });
    const result = computeProximity(me, list, zs, state.current, { dataSaver: saver });
    state.current = result.state;
    const videoSet = new Set(result.videoIds);

    // Apply to LiveKit: subscribe only to people in range.
    if (r) {
      for (const participant of r.remoteParticipants.values()) {
        const link = result.links.get(participant.identity);
        for (const pub of participant.trackPublications.values()) {
          const isVideo = pub.kind === 'video';
          const isScreen = pub.source === 'screen_share' || pub.source === 'screen_share_audio';
          const want = !!link && (isVideo ? isScreen || videoSet.has(participant.identity) : link.audio);
          if (pub.isSubscribed !== want) pub.setSubscribed(want);
          if (want && isVideo && !isScreen) pub.setVideoQuality(saver ? 0 /* VideoQuality.LOW */ : 2 /* HIGH */);
        }
        if (link) participant.setVolume(link.volume);
      }
    }

    const inRange = [...result.links.entries()]
      .map(([id, link]) => ({ id, link, video: videoSet.has(id) }))
      .sort((a, b) => (a.link.distance ?? 0) - (b.link.distance ?? 0));
    const next = { inRange, myGroup: result.myGroup, groups: result.groups };
    const s = signature(next);
    if (s !== sig.current) { sig.current = s; setView(next); }
  }, [remotes]);

  // At least every 500 ms (remote positions arrive outside React).
  useEffect(() => {
    const t = window.setInterval(reconcile, RECONCILE_MS);
    return () => window.clearInterval(t);
  }, [reconcile]);

  // Right away when my position, zone, the people list, or data saver changes.
  useEffect(() => { reconcile(); }, [reconcile, myPos?.x, myPos?.z, myZone, people, zones, dataSaver, room]);

  // New tracks appear unsubscribed (autoSubscribe is off): decide immediately. Play subscribed audio.
  useEffect(() => {
    if (!room) return;
    const box = document.createElement('div');
    box.dataset.proximityAudio = '';
    box.style.display = 'none';
    document.body.appendChild(box);
    const onPublished = () => reconcile();
    const onSubscribed = (track: RemoteTrack) => {
      if (track.kind !== 'audio') return;
      const el = track.attach();
      box.appendChild(el);
    };
    const onUnsubscribed = (track: RemoteTrack) => {
      if (track.kind === 'audio') track.detach().forEach((el) => el.remove());
    };
    room.on('trackPublished', onPublished).on('participantConnected', onPublished)
      .on('trackSubscribed', onSubscribed).on('trackUnsubscribed', onUnsubscribed);
    return () => {
      room.off('trackPublished', onPublished).off('participantConnected', onPublished)
        .off('trackSubscribed', onSubscribed).off('trackUnsubscribed', onUnsubscribed);
      box.remove();
    };
  }, [room, reconcile]);

  return { ...view, reconcile };
}

/** The camera publication we're receiving for someone, if any. */
export function cameraOf(room: Room | null, identity: string): RemoteTrackPublication | null {
  const p = room?.remoteParticipants.get(identity);
  if (!p) return null;
  for (const pub of p.trackPublications.values()) if (pub.source === 'camera' && pub.isSubscribed && pub.track) return pub;
  return null;
}
