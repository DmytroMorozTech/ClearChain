import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import type { LucideIcon } from 'lucide-react';

interface ViewToggleOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

interface ViewToggleProps<T extends string> {
  /** `null` selects nothing — for a control whose options do not cover every state. */
  value: T | null;
  onChange: (value: T) => void;
  options: readonly ViewToggleOption<T>[];
  /** Names the group for screen readers — "Chain view", "Chart view". */
  label: string;
}

/**
 * A segmented control for switching between two renderings of the same data.
 *
 * Both options stay visible, which a switch cannot do: a reader who has never pressed it
 * can still see that the other view exists. The selected segment lifts onto the paper
 * colour and takes the brand indigo, matching the active state in the navigation bar.
 */
export function ViewToggle<T extends string>({
  value,
  onChange,
  options,
  label,
}: ViewToggleProps<T>) {
  return (
    <ToggleButtonGroup
      value={value}
      exclusive
      size="small"
      aria-label={label}
      onChange={(_event, next: T | null) => {
        // Null arrives when the selected segment is pressed again. A view has to be
        // something, so that press is ignored rather than clearing the selection.
        if (next !== null) onChange(next);
      }}
      sx={{
        backgroundColor: 'action.hover',
        borderRadius: '999px',
        p: '3px',
        '& .MuiToggleButtonGroup-grouped': {
          border: 0,
          borderRadius: '999px !important',
          gap: 0.75,
          px: 1.75,
          py: 0.5,
          fontSize: 13,
          fontWeight: 600,
          textTransform: 'none',
          color: 'text.secondary',
          transition: 'background-color 160ms, color 160ms, box-shadow 160ms',
          '&:hover': { backgroundColor: 'transparent', color: 'text.primary' },
          '&.Mui-selected': {
            backgroundColor: 'background.paper',
            color: 'primary.main',
            boxShadow: '0 1px 2px rgba(15, 23, 42, 0.12)',
            '&:hover': { backgroundColor: 'background.paper' },
          },
        },
      }}
    >
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon }) => (
        <ToggleButton key={optionValue} value={optionValue}>
          {Icon && <Icon size={15} aria-hidden />}
          {optionLabel}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
