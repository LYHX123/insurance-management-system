"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { updateReminderSettingsAction } from "@/app/(app)/settings/actions";
import type { SettingsData } from "./settings-content";

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-zinc-800">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-zinc-300 text-emerald-700 focus:ring-emerald-600"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

export function ReminderSettingsForm({ settings }: { settings: SettingsData }) {
  const { t } = useLocale();
  const router = useRouter();

  const [policyRemindersEnabled, setPolicyRemindersEnabled] = useState(settings.policyRemindersEnabled);
  const [motorPolicyReminderDays, setMotorPolicyReminderDays] = useState(String(settings.motorPolicyReminderDays));
  const [otherPolicyReminderDays, setOtherPolicyReminderDays] = useState(String(settings.otherPolicyReminderDays));
  const [dailyTaskRemindersEnabled, setDailyTaskRemindersEnabled] = useState(settings.dailyTaskRemindersEnabled);
  const [dailyTaskReminderDays, setDailyTaskReminderDays] = useState(String(settings.dailyTaskReminderDays));
  const [claimRemindersEnabled, setClaimRemindersEnabled] = useState(settings.claimRemindersEnabled);
  const [claimReminderDays, setClaimReminderDays] = useState(String(settings.claimReminderDays));
  const [loginReminderPopupEnabled, setLoginReminderPopupEnabled] = useState(settings.loginReminderPopupEnabled);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    const days = {
      motorPolicyReminderDays: Number(motorPolicyReminderDays),
      otherPolicyReminderDays: Number(otherPolicyReminderDays),
      dailyTaskReminderDays: Number(dailyTaskReminderDays),
      claimReminderDays: Number(claimReminderDays),
    };
    const isValidDays = (n: number) => Number.isInteger(n) && n >= 0 && n <= 365;
    if (Object.values(days).some((n) => !isValidDays(n))) {
      setError(t.settings.invalidReminderDays);
      return;
    }

    setIsSubmitting(true);
    const result = await updateReminderSettingsAction({
      policyRemindersEnabled,
      dailyTaskRemindersEnabled,
      claimRemindersEnabled,
      loginReminderPopupEnabled,
      ...days,
    });
    setIsSubmitting(false);

    if (!result.success) {
      setError(
        result.error === "INVALID_REMINDER_DAYS" ? t.settings.invalidReminderDays : t.settings.saveError
      );
      return;
    }

    setMessage(t.settings.saveSuccess);
    router.refresh();
  };

  return (
    <Card className="max-w-2xl p-6">
      <form onSubmit={handleSubmit} className="form-stack">
        <ToggleRow
          label={t.settings.enableLoginReminderPopup}
          checked={loginReminderPopupEnabled}
          onChange={setLoginReminderPopupEnabled}
        />

        <div className="mt-2 flex flex-col gap-3 rounded-control border border-zinc-200 p-4">
          <ToggleRow
            label={t.settings.enablePolicyReminders}
            checked={policyRemindersEnabled}
            onChange={setPolicyRemindersEnabled}
          />
          <FormField label={t.settings.motorPolicyReminderDays}>
            <Input
              type="number"
              min={0}
              max={365}
              step={1}
              value={motorPolicyReminderDays}
              onChange={(e) => setMotorPolicyReminderDays(e.target.value)}
              disabled={!policyRemindersEnabled}
            />
          </FormField>
          <FormField label={t.settings.otherPolicyReminderDays}>
            <Input
              type="number"
              min={0}
              max={365}
              step={1}
              value={otherPolicyReminderDays}
              onChange={(e) => setOtherPolicyReminderDays(e.target.value)}
              disabled={!policyRemindersEnabled}
            />
            <p className="text-xs text-zinc-500">{t.settings.otherPolicyHint}</p>
          </FormField>
        </div>

        <div className="flex flex-col gap-3 rounded-control border border-zinc-200 p-4">
          <ToggleRow
            label={t.settings.enableDailyTaskReminders}
            checked={dailyTaskRemindersEnabled}
            onChange={setDailyTaskRemindersEnabled}
          />
          <FormField label={t.settings.dailyTaskReminderDays}>
            <Input
              type="number"
              min={0}
              max={365}
              step={1}
              value={dailyTaskReminderDays}
              onChange={(e) => setDailyTaskReminderDays(e.target.value)}
              disabled={!dailyTaskRemindersEnabled}
            />
          </FormField>
        </div>

        <div className="flex flex-col gap-3 rounded-control border border-zinc-200 p-4">
          <ToggleRow
            label={t.settings.enableClaimReminders}
            checked={claimRemindersEnabled}
            onChange={setClaimRemindersEnabled}
          />
          <FormField label={t.settings.claimReminderDays}>
            <Input
              type="number"
              min={0}
              max={365}
              step={1}
              value={claimReminderDays}
              onChange={(e) => setClaimReminderDays(e.target.value)}
              disabled={!claimRemindersEnabled}
            />
          </FormField>
        </div>

        <p className="text-xs text-zinc-500">{t.settings.reminderDaysHint}</p>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {message && <p className="text-sm text-emerald-700">{message}</p>}

        <div className="mt-2 flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {t.common.save}
          </Button>
        </div>
      </form>
    </Card>
  );
}
