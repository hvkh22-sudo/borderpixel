import { Text as RNText, type TextProps } from 'react-native';

import { useTheme } from '../theme/ThemeProvider';
import { MAX_FONT_SCALE, typography, type TypographyVariant } from '../theme/tokens';

interface Props extends TextProps {
  variant?: TypographyVariant;
  muted?: boolean;
  color?: string;
  center?: boolean;
}

export function Text({ variant = 'body', muted, color, center, style, ...rest }: Props) {
  const { colors } = useTheme();
  return (
    <RNText
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      {...rest}
      style={[
        typography[variant],
        { color: color ?? (muted ? colors.textMuted : colors.text), textAlign: center ? 'center' : undefined },
        style,
      ]}
    />
  );
}
