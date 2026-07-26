import type { ClaimCustomerOption, ClaimProjectOption } from "@/components/claims/types";

export type ClaimContact = { name: string; phone: string };

// Customer's own primary contact — used both when a Customer is selected
// with no Project, and as the fallback for whichever half of a Project's
// contact is blank (see the Project Contact Prefill Fix task).
export function resolveCustomerContact(customer: ClaimCustomerOption | undefined): ClaimContact {
  return {
    name: customer?.mainContactPerson?.trim() || "",
    phone: customer?.mainPhoneNumber?.trim() || "",
  };
}

// A Project's own contact takes priority field-by-field; a blank
// contactPerson or phoneNumber on the Project falls back independently to
// the Customer's contact — never blanks out a valid Customer value (see
// this task's spec, Part 3).
export function resolveProjectContact(project: ClaimProjectOption | undefined, customer: ClaimCustomerOption | undefined): ClaimContact {
  const customerContact = resolveCustomerContact(customer);
  const projectName = project?.contactPerson?.trim();
  const projectPhone = project?.phoneNumber?.trim();
  return {
    name: projectName || customerContact.name,
    phone: projectPhone || customerContact.phone,
  };
}
