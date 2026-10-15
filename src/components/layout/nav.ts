/** The main menu's sections, in the sidebar and in the bottom feature dock. */
import {
  BoltIcon, CubeIcon, CalendarDaysIcon, ChatBubbleLeftRightIcon, DocumentTextIcon,
  FolderIcon, HomeIcon, BuildingOffice2Icon, SignalIcon, MicrophoneIcon, PresentationChartBarIcon, SparklesIcon, Squares2X2Icon, TicketIcon, UserIcon, VideoCameraIcon,
} from '@heroicons/react/24/solid';

// Everyday places first, then tools: the arrangement from the redesign.
export const navGroups = [
  [
    { label: 'Dashboard', icon: HomeIcon, path: '/dashboard' },
    { label: 'Conversations', icon: ChatBubbleLeftRightIcon, path: '/conversations' },
    { label: 'Contacts', icon: UserIcon, path: '/contacts' },
    { label: 'Calendars', icon: CalendarDaysIcon, path: '/calendars' },
    { label: 'Meetings', icon: VideoCameraIcon, path: '/meetings' },
    { label: 'Rooms', icon: BuildingOffice2Icon, path: '/rooms' },
    { label: 'Workspaces', icon: Squares2X2Icon, path: '/workspace' },
    { label: 'Events', icon: TicketIcon, path: '/events' },
    { label: 'Streams', icon: SignalIcon, path: '/streams' },
  ],
  [
    { label: 'Webinars', icon: PresentationChartBarIcon, path: '/webinars' },
    { label: 'Submissions', icon: DocumentTextIcon, path: '/forms' },
    { label: 'Workflows', icon: BoltIcon, path: '/workflows' },
    { label: 'Recordings', icon: MicrophoneIcon, path: '/recordings' },
    { label: 'Characters', icon: CubeIcon, path: '/characters' },
    { label: 'Media Library', icon: FolderIcon, path: '/media-library' },
    { label: 'AI Hub', icon: SparklesIcon, path: '/ai-hub' },
  ],
];

/** Is this the section you're in? */
export const isNavActive = (currentPath: string, path: string) =>
  currentPath === path || currentPath.startsWith(path + '/') || currentPath.startsWith(path + '?') || (path === '/dashboard' && currentPath === '/') || (path === '/workspace' && currentPath.startsWith('/workspaces'));

