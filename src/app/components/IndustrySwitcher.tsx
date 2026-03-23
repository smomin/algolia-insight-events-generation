'use client';

const COLOR_MAP: Record<string, { tab: string; active: string; dot: string }> = {
  blue:    { tab: 'border-blue-500 text-blue-400',       active: 'bg-blue-500/10',       dot: 'bg-blue-400' },
  emerald: { tab: 'border-emerald-500 text-emerald-400', active: 'bg-emerald-500/10',    dot: 'bg-emerald-400' },
  rose:    { tab: 'border-rose-500 text-rose-400',       active: 'bg-rose-500/10',       dot: 'bg-rose-400' },
  amber:   { tab: 'border-amber-500 text-amber-400',     active: 'bg-amber-500/10',      dot: 'bg-amber-400' },
  violet:  { tab: 'border-violet-500 text-violet-400',   active: 'bg-violet-500/10',     dot: 'bg-violet-400' },
  cyan:    { tab: 'border-cyan-500 text-cyan-400',       active: 'bg-cyan-500/10',       dot: 'bg-cyan-400' },
  orange:  { tab: 'border-orange-500 text-orange-400',   active: 'bg-orange-500/10',     dot: 'bg-orange-400' },
  pink:    { tab: 'border-pink-500 text-pink-400',       active: 'bg-pink-500/10',       dot: 'bg-pink-400' },
  teal:    { tab: 'border-teal-500 text-teal-400',       active: 'bg-teal-500/10',       dot: 'bg-teal-400' },
  indigo:  { tab: 'border-indigo-500 text-indigo-400',   active: 'bg-indigo-500/10',     dot: 'bg-indigo-400' },
  lime:    { tab: 'border-lime-500 text-lime-400',       active: 'bg-lime-500/10',       dot: 'bg-lime-400' },
  red:     { tab: 'border-red-500 text-red-400',         active: 'bg-red-500/10',        dot: 'bg-red-400' },
};

export interface IndustrySummary {
  id: string;
  name: string;
  icon: string;
  color: string;
  personaCount: number;
}

export interface RunningStatus {
  [industryId: string]: {
    isRunning: boolean;
    isDistributing: boolean;
  };
}

interface IndustrySwitcherProps {
  industries: IndustrySummary[];
  activeIndustry: string;
  runningStatus: RunningStatus;
  onSwitch: (id: string) => void;
}

export default function IndustrySwitcher({
  industries,
  activeIndustry,
  runningStatus,
  onSwitch,
}: IndustrySwitcherProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {industries.map((industry) => {
        const colors = COLOR_MAP[industry.color] ?? COLOR_MAP.blue;
        const isActive = activeIndustry === industry.id;
        const status = runningStatus[industry.id];
        const isRunning = status?.isRunning;
        const isWorking = status?.isDistributing;

        return (
          <button
            key={industry.id}
            onClick={() => onSwitch(industry.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all border ${
              isActive
                ? `${colors.tab} ${colors.active} border-current`
                : 'border-slate-700 text-slate-400 hover:text-slate-200 hover:border-slate-500'
            }`}
          >
            <span className="text-base leading-none">{industry.icon}</span>
            <span>{industry.name}</span>
            <span className="text-[10px] text-slate-500 font-normal">
              ({industry.personaCount})
            </span>
            {(isRunning || isWorking) && (
              <span
                className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  isWorking
                    ? `${colors.dot} animate-pulse`
                    : colors.dot
                }`}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
