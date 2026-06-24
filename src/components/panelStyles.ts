/** Shared typography and spacing for left/right sidebar panels (sysid + traj gen). */

export const panelAside = 'flex flex-col bg-gray-900 h-full overflow-hidden text-sm';

export const panelTab = (active: boolean) =>
  `flex-1 px-2 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
    active ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-500 hover:text-gray-300'
  }`;

export const panelContent = 'flex-1 overflow-y-auto p-4 space-y-5';

export const panelSectionTitle = 'text-sm font-semibold text-gray-400 uppercase tracking-wide';

export const panelSubsectionTitle = 'text-sm font-medium text-gray-400';

export const panelItemTitle = 'text-base font-semibold text-white';

export const panelLabel = 'text-sm text-gray-400 block mb-1.5';

export const panelLabelInline = 'text-sm font-medium text-gray-300';

export const panelBody = 'text-sm text-gray-500 leading-relaxed';

export const panelHint = 'text-xs text-gray-500 leading-relaxed';

export const panelMeta = 'text-xs text-gray-500';

export const panelInput =
  'w-full text-sm bg-gray-800 border border-gray-600 rounded-md px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-blue-500';

export const panelInputCompact =
  'text-sm bg-gray-800 border border-gray-600 rounded-md px-2 py-1.5 text-white focus:outline-none focus:border-blue-500';

export const panelInputNumeric =
  'w-20 text-sm text-right bg-gray-800 border border-gray-600 rounded-md px-2 py-1.5 text-white focus:outline-none focus:border-blue-500';

export const panelBtn =
  'flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed';

export const panelBtnPrimary =
  'flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors';

export const panelListItem = 'px-3 py-2.5 rounded-lg text-sm transition-colors';

export const panelEmpty = 'text-sm text-gray-500 text-center leading-relaxed';

export const panelMono = 'font-mono tabular-nums';

export const panelDivider = 'border-t border-gray-700';

export const panelCheckboxBase =
  'h-4 w-4 shrink-0 rounded border-gray-600 bg-gray-800 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-0 focus:ring-offset-gray-900 disabled:cursor-not-allowed disabled:opacity-50';

export const panelCheckboxBlue = `${panelCheckboxBase} text-blue-500 focus:ring-blue-500`;

export const panelCheckboxGreen = `${panelCheckboxBase} text-green-500 focus:ring-green-500`;
