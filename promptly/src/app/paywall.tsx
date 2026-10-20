import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PurchasesPackage } from 'react-native-purchases';

import { Button } from '../components/Button';
import { IconButton } from '../components/IconButton';
import { Text } from '../components/Text';
import { LIMITS, deriveAccess, paywallPlan } from '../features/monetization/entitlements';
import { t, type TKey } from '../localization/i18n';
import { track } from '../services/analytics';
import { config } from '../services/config';
import { fetchPackages, purchase, restore, type PaywallPackages } from '../services/purchases';
import { useAccess } from '../state/access';
import { useTheme } from '../theme/ThemeProvider';
import { radius, spacing } from '../theme/tokens';

type PlanKey = 'monthly' | 'annual' | 'lifetime';

export default function Paywall() {
  const { trigger } = useLocalSearchParams<{ trigger?: string }>();
  const { colors } = useTheme();
  const access = useAccess((s) => s.access);
  const plan = paywallPlan(access);
  const [packages, setPackages] = useState<PaywallPackages | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [preferred, setSelected] = useState<PlanKey>(plan.showSubscriptions ? 'annual' : 'lifetime');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    track({ name: 'paywall_viewed', trigger: trigger === 'voiceFollow' || trigger === 'captionStyle' ? trigger : 'general' });
    fetchPackages()
      .then((p) => {
        setPackages(p);
        if (!p.monthly && !p.annual && !p.lifetime) setLoadFailed(true);
      })
      .catch(() => setLoadFailed(true));
  }, [trigger]);

  const options: { key: PlanKey; pkg: PurchasesPackage | null; label: string; price: string; badge?: string }[] = [];
  if (packages && plan.showSubscriptions) {
    if (packages.annual)
      options.push({ key: 'annual', pkg: packages.annual, label: t('paywall.annual'), price: t('paywall.perYear', { price: packages.annual.product.priceString }), badge: t('paywall.annualSave') });
    if (packages.monthly) options.push({ key: 'monthly', pkg: packages.monthly, label: t('paywall.monthly'), price: t('paywall.perMonth', { price: packages.monthly.product.priceString }) });
  }
  if (packages?.lifetime && plan.showLifetime)
    options.push({ key: 'lifetime', pkg: packages.lifetime, label: t('paywall.lifetime'), price: t('paywall.once', { price: packages.lifetime.product.priceString }) });
  // The offering may lack the preferred plan: fall back to the first available one so Subscribe always works.
  const selected: PlanKey = options.some((o) => o.key === preferred) ? preferred : (options[0]?.key ?? preferred);

  const buy = async () => {
    const pkg = options.find((o) => o.key === selected)?.pkg;
    if (!pkg) return;
    setBusy(true);
    setMessage(null);
    const res = await purchase(pkg);
    setBusy(false);
    if (res.status === 'purchased') {
      useAccess.getState().setAccess(deriveAccess(res.info));
      track({ name: 'purchase_completed', product: selected });
      router.back();
    } else if (res.status === 'pending') setMessage(t('paywall.pending'));
    else if (res.status === 'error') setMessage(t('paywall.failed'));
  };

  const doRestore = async () => {
    setBusy(true);
    try {
      const info = await restore();
      const a = deriveAccess(info);
      useAccess.getState().setAccess(a);
      track({ name: 'purchase_restored', found: a.isPro });
      setMessage(a.isPro ? t('paywall.restored') : t('paywall.nothingToRestore'));
    } catch {
      setMessage(t('paywall.unavailable'));
    } finally {
      setBusy(false);
    }
  };

  const triggerKey = trigger === 'voiceFollow' || trigger === 'captionStyle' ? (`paywall.trigger.${trigger}` as TKey) : null;
  const benefits: string[] = [
    t('paywall.benefit1'),
    t('paywall.benefit2'),
    selected === 'lifetime' ? t('paywall.benefitLifetimeAi', { n: LIMITS.lifetimeAiCreditGrant }) : t('paywall.benefit3'),
    t('paywall.benefit4'),
  ];

  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: colors.background }]}>
      <View style={styles.close}>
        <IconButton testID="paywall-close" icon="close" label={t('common.close')} onPress={() => router.back()} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        <Text testID="paywall-title" variant="display" accessibilityRole="header">
          {t('paywall.title')}
        </Text>
        <Text muted>{triggerKey ? t(triggerKey) : t('paywall.subtitle')}</Text>
        <View style={styles.benefits}>
          {benefits.map((b) => (
            <View key={b} style={styles.benefit}>
              <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              <Text variant="callout" style={styles.flex}>
                {b}
              </Text>
            </View>
          ))}
        </View>

        {plan.noticeKey ? (
          <Text variant="callout" color={colors.warning}>
            {t(plan.noticeKey as TKey)}
          </Text>
        ) : null}

        {!packages && !loadFailed ? <ActivityIndicator color={colors.primary} /> : null}
        {loadFailed ? <Text testID="paywall-unavailable" muted center>{t('paywall.unavailable')}</Text> : null}

        <View style={styles.options} accessibilityRole="radiogroup">
          {options.map((o) => {
            const sel = o.key === selected;
            return (
              <Pressable
                key={o.key}
                accessibilityRole="radio"
                accessibilityState={{ selected: sel }}
                accessibilityLabel={`${o.label}, ${o.price}`}
                onPress={() => setSelected(o.key)}
                style={[styles.option, { borderColor: sel ? colors.primary : colors.border, backgroundColor: colors.surface }]}
              >
                <Ionicons name={sel ? 'radio-button-on' : 'radio-button-off'} size={22} color={sel ? colors.primary : colors.textMuted} />
                <View style={styles.flex}>
                  <Text variant="headline">{o.label}</Text>
                  <Text variant="callout" muted>
                    {o.price}
                  </Text>
                </View>
                {o.badge ? (
                  <View style={[styles.badge, { backgroundColor: colors.primary }]}>
                    <Text variant="overline" color="#fff">
                      {o.badge}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
        {selected === 'lifetime' ? (
          <Text variant="caption" muted>
            {t('paywall.lifetimeNote', { n: LIMITS.lifetimeAiCreditGrant })}
          </Text>
        ) : null}
        {message ? (
          <Text testID="paywall-message" center accessibilityLiveRegion="polite">
            {message}
          </Text>
        ) : null}
      </ScrollView>
      <View style={styles.footer}>
        <Button testID="paywall-subscribe" label={t('paywall.subscribe')} size="lg" onPress={buy} loading={busy} disabled={options.length === 0} />
        <Button testID="paywall-restore" label={t('paywall.restore')} variant="ghost" onPress={doRestore} disabled={busy} />
        <Text variant="caption" muted center>
          {t('paywall.legal')}
        </Text>
        <View style={styles.links}>
          {config.termsUrl ? <Button label={t('paywall.terms')} variant="ghost" onPress={() => Linking.openURL(config.termsUrl)} /> : null}
          {config.privacyUrl ? <Button label={t('paywall.privacy')} variant="ghost" onPress={() => Linking.openURL(config.privacyUrl)} /> : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  close: { alignItems: 'flex-end', paddingHorizontal: spacing.sm },
  content: { padding: spacing.xl, gap: spacing.lg },
  benefits: { gap: spacing.md },
  benefit: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  options: { gap: spacing.md },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, borderWidth: 2 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.sm },
  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.xs },
  links: { flexDirection: 'row', justifyContent: 'center' },
});
