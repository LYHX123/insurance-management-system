"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { useLocale } from "@/i18n/locale-provider";
import { updateCustomerAction } from "@/app/(app)/customer/actions";
import type { CustomerDetail } from "@/components/customers/types";

const ERROR_KEY: Record<string, string> = {
  COMPANY_NAME_REQUIRED: "requiredField",
  PIN_NUMBER_REQUIRED: "requiredField",
  COMPANY_NAME_TAKEN: "companyNameTaken",
  PIN_NUMBER_TAKEN: "pinNumberTaken",
  INVALID_PHONE: "invalidPhone",
  SHORT_NAME_INVALID_CHARACTERS: "shortNameInvalidCharacters",
  SHORT_NAME_TOO_LONG: "shortNameTooLong",
};

export function EditCustomerModal({
  customer,
  onClose,
  onSuccess,
}: {
  customer: CustomerDetail;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const { t } = useLocale();
  const [companyName, setCompanyName] = useState(customer.companyName);
  const [pinNumber, setPinNumber] = useState(customer.pinNumber);
  const [registeredAddress, setRegisteredAddress] = useState(customer.registeredAddress ?? "");
  const [mainContactPerson, setMainContactPerson] = useState(customer.mainContactPerson ?? "");
  const [mainPhoneNumber, setMainPhoneNumber] = useState(customer.mainPhoneNumber ?? "");
  const [shortName, setShortName] = useState(customer.shortName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!companyName.trim() || !pinNumber.trim()) {
      setError(t.customers.requiredField);
      return;
    }

    setIsSubmitting(true);
    const result = await updateCustomerAction(customer.id, {
      companyName,
      pinNumber,
      registeredAddress,
      mainContactPerson,
      mainPhoneNumber,
      shortName,
    });
    setIsSubmitting(false);

    if (!result.success) {
      const key = ERROR_KEY[result.error] ?? "genericError";
      setError(t.customers[key as keyof typeof t.customers]);
      return;
    }

    onSuccess(t.customers.updateSuccess);
  };

  return (
    <Modal title={t.customers.editCustomerTitle} onClose={onClose}>
      <form onSubmit={handleSubmit} className="form-stack">
        <div className="form-grid">
          <FormField label={t.customers.companyName}>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
          </FormField>
          <FormField label={t.customers.pinNumber}>
            <Input value={pinNumber} onChange={(e) => setPinNumber(e.target.value)} required />
          </FormField>
          <FormField label={t.customers.registeredAddress}>
            <Input value={registeredAddress} onChange={(e) => setRegisteredAddress(e.target.value)} />
          </FormField>
          <FormField label={t.customers.mainContactPerson}>
            <Input value={mainContactPerson} onChange={(e) => setMainContactPerson(e.target.value)} />
          </FormField>
          <FormField label={t.customers.mainPhoneNumber}>
            <Input
              type="tel"
              placeholder="0712345678"
              value={mainPhoneNumber}
              onChange={(e) => setMainPhoneNumber(e.target.value)}
            />
          </FormField>
          <FormField label={t.customers.shortName} hint={t.customers.shortNameHint}>
            <Input value={shortName} onChange={(e) => setShortName(e.target.value)} />
          </FormField>
        </div>

        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={isSubmitting}>
            {t.common.cancel}
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {t.common.save}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
