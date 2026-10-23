import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useBootstrap } from '../hooks/useBootstrap';
import { t } from '../localization/i18n';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';

function Navigator() {
  const { colors, dark } = useTheme();
  const { ready } = useBootstrap();
  // The three Create options don't fit the half-height sheet at large text sizes; open it taller there.
  const createDetents = useWindowDimensions().fontScale > 1.3 ? [0.9] : [0.55, 0.9];
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} accessibilityLabel={t('common.loading')} />
      </View>
    );
  }
  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Screen name="index" options={{ title: '', headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="create" options={{ presentation: 'formSheet', headerShown: false, sheetAllowedDetents: createDetents }} />
        <Stack.Screen name="scripts/index" options={{ title: t('library.title') }} />
        <Stack.Screen name="scripts/[id]" options={{ title: '' }} />
        <Stack.Screen name="studio" options={{ presentation: 'modal', title: t('studio.title') }} />
        <Stack.Screen name="prepare/[id]" options={{ title: t('prepare.title') }} />
        <Stack.Screen name="record/[id]" options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="take/[id]" options={{ title: t('preview.title') }} />
        <Stack.Screen name="captions/[id]" options={{ title: t('captions.title') }} />
        <Stack.Screen name="export/[id]" options={{ presentation: 'formSheet', title: t('export.title'), sheetAllowedDetents: [0.7, 0.95] }} />
        <Stack.Screen name="takes" options={{ title: t('takes.title') }} />
        <Stack.Screen name="paywall" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="settings/index" options={{ title: t('settings.title') }} />
        <Stack.Screen name="settings/subscription" options={{ title: t('subscription.title') }} />
        <Stack.Screen name="settings/privacy" options={{ title: t('privacy.title') }} />
        <Stack.Screen name="settings/help" options={{ title: t('help.title') }} />
        <Stack.Screen name="settings/diagnostics" options={{ title: t('diagnostics.title') }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Navigator />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
