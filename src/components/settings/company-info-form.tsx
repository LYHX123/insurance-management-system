"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Trash2 } from "lucide-react";
import { useLocale } from "@/i18n/locale-provider";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import {
  updateCompanyInfoAction,
  uploadLogoAction,
  removeLogoAction,
} from "@/app/(app)/settings/actions";
import type { SettingsData } from "./settings-content";

export function CompanyInfoForm({ settings }: { settings: SettingsData }) {
  const { t } = useLocale();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [companyName, setCompanyName] = useState(settings.companyName ?? "");
  const [pinNumber, setPinNumber] = useState(settings.pinNumber ?? "");
  const [phoneNumber, setPhoneNumber] = useState(settings.phoneNumber ?? "");
  const [email, setEmail] = useState(settings.email ?? "");
  const [address, setAddress] = useState(settings.address ?? "");
  const [website, setWebsite] = useState(settings.website ?? "");
  const [hasLogo, setHasLogo] = useState(settings.hasLogo);
  const [logoCacheBust, setLogoCacheBust] = useState(0);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setIsSubmitting(true);

    const result = await updateCompanyInfoAction({
      companyName: companyName.trim() || null,
      pinNumber: pinNumber.trim() || null,
      phoneNumber: phoneNumber.trim() || null,
      email: email.trim() || null,
      address: address.trim() || null,
      website: website.trim() || null,
    });

    setIsSubmitting(false);

    if (!result.success) {
      setError(
        result.error === "INVALID_EMAIL"
          ? t.settings.invalidEmail
          : result.error === "INVALID_PHONE"
          ? t.settings.invalidPhone
          : t.settings.saveError
      );
      return;
    }

    setMessage(t.settings.saveSuccess);
    router.refresh();
  };

  const handleLogoSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setMessage(null);
    setIsUploadingLogo(true);

    const formData = new FormData();
    formData.set("file", file);
    const result = await uploadLogoAction(formData);

    setIsUploadingLogo(false);

    if (!result.success) {
      setError(
        result.error === "FILE_TOO_LARGE"
          ? t.settings.fileTooLarge
          : result.error === "UNSUPPORTED_FILE_TYPE"
          ? t.settings.unsupportedFileType
          : t.settings.saveError
      );
      return;
    }

    setHasLogo(true);
    setLogoCacheBust((n) => n + 1);
    setMessage(t.settings.saveSuccess);
  };

  const handleRemoveLogo = async () => {
    setError(null);
    setMessage(null);
    const result = await removeLogoAction();
    if (result.success) {
      setHasLogo(false);
      setMessage(t.settings.saveSuccess);
    } else {
      setError(t.settings.saveError);
    }
  };

  return (
    <Card className="max-w-2xl p-6">
      <div className="flex flex-col gap-5">
        <FormField label={t.settings.companyLogo}>
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
              {hasLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/settings/logo?v=${logoCacheBust}`}
                  alt={t.settings.companyLogo}
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-xs text-zinc-400">{t.settings.noLogo}</span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={isUploadingLogo}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={16} />
                  {hasLogo ? t.settings.replaceLogo : t.settings.uploadLogo}
                </Button>
                {hasLogo && (
                  <Button type="button" variant="ghost" onClick={handleRemoveLogo}>
                    <Trash2 size={16} />
                    {t.settings.removeLogo}
                  </Button>
                )}
              </div>
              <p className="text-xs text-zinc-500">{t.settings.logoHint}</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={handleLogoSelect}
            />
          </div>
        </FormField>

        <form onSubmit={handleSubmit} className="form-stack">
          <FormField label={t.settings.companyName}>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </FormField>
          <FormField label={t.settings.pinNumber}>
            <Input value={pinNumber} onChange={(e) => setPinNumber(e.target.value)} />
          </FormField>
          <FormField label={t.settings.phoneNumber}>
            <Input
              type="tel"
              value={phoneNumber}
              placeholder="0712345678"
              onChange={(e) => setPhoneNumber(e.target.value)}
            />
          </FormField>
          <FormField label={t.settings.email}>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField label={t.settings.address}>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </FormField>
          <FormField label={t.settings.website}>
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} />
          </FormField>

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
      </div>
    </Card>
  );
}
