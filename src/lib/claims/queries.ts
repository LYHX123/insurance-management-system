import { prisma } from "@/lib/prisma";
import type {
  MotorClaimRow,
  MotorClaimDetail,
  MotorClaimDocumentRow,
  NonMotorClaimRow,
  NonMotorClaimDetail,
  NonMotorClaimDocumentRow,
  ClaimCustomerOption,
  ClaimParticipantRow,
  ClaimTimelineRow,
  ClaimDocumentDropboxInfo,
} from "@/components/claims/types";

// Dropbox Integration Phase 7 — placeholder used only until the caller
// (the detail page) overwrites it with the real per-document view from
// motorClaimPathViewModel.ts/nonMotorClaimPathViewModel.ts. Never rendered
// as-is: buildDropboxPathView always returns a real state (at minimum
// "not_connected"), this literal is just a type-satisfying default so this
// module (a plain data query, no Dropbox network/DB calls of its own)
// doesn't need to depend on the Dropbox integration to compile.
const PENDING_DROPBOX_INFO: ClaimDocumentDropboxInfo = { view: { state: "pending", path: null, isPlanned: true, errorMessage: null }, standardizedFileName: null, lastSyncedAt: null };

const USER_SELECT = { id: true, fullName: true, username: true, status: true, role: true } as const;

// Active-only, same convention as every other Customer picker in this app
// — carries the two contact fields the Claim form prefills from, plus that
// customer's own Projects for the customer-scoped Project selector (see
// this phase's spec, Part B.3).
export async function getActiveClaimCustomers(): Promise<ClaimCustomerOption[]> {
  const customers = await prisma.customer.findMany({
    where: { status: "ACTIVE" },
    orderBy: { companyName: "asc" },
    select: {
      id: true,
      companyName: true,
      customerNumber: true,
      mainContactPerson: true,
      mainPhoneNumber: true,
      projects: { select: { id: true, projectName: true, contactPerson: true, phoneNumber: true }, orderBy: { projectName: "asc" } },
    },
  });
  return customers;
}

async function resolveUserNames(ids: Set<string>): Promise<Map<string, string>> {
  const users = ids.size ? await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: USER_SELECT }) : [];
  return new Map(users.map((u) => [u.id, u.fullName || u.username]));
}

// Restricted at the database level to Claims the given user participates in
// — never fetched broadly and filtered client-side (see this phase's spec,
// Part C.8 / Part K.43). OPEN and CLOSED are fetched as two separate
// queries with different secondary sort keys (see this phase's spec, Part
// F.21 / Part J.39): OPEN by updatedAt desc (then reportedAt desc), CLOSED
// by closedAt desc (then updatedAt desc) — the same two-query-then-
// concatenate approach used for Daily Task's ACTIVE/COMPLETED groups, since
// a single Prisma orderBy array cannot express two different secondary keys
// per status group.
// Phase 8.1 Part 4 — customerId is an optional additional narrowing filter
// (the "View All Motor Claims" deep-link from Customer Detail's Related
// Records tab), always merged alongside the existing participant-scoping
// filter below, never replacing it: a user must remain unable to see a
// Claim they aren't a participants member of, customerId or not.
export async function getMotorClaims(userId: string, customerId?: string): Promise<MotorClaimRow[]> {
  const baseWhere = { deletedAt: null, participants: { some: { userId } }, ...(customerId ? { customerId } : {}) } as const;
  const include = {
    customer: { select: { companyName: true } },
    project: { select: { projectName: true } },
    participants: { select: { userId: true } },
  } as const;

  const [open, closed] = await Promise.all([
    prisma.motorClaim.findMany({ where: { ...baseWhere, status: "OPEN" }, include, orderBy: [{ updatedAt: "desc" }, { reportedAt: "desc" }] }),
    prisma.motorClaim.findMany({ where: { ...baseWhere, status: "CLOSED" }, include, orderBy: [{ closedAt: "desc" }, { updatedAt: "desc" }] }),
  ]);
  const claims = [...open, ...closed];

  const userIds = new Set<string>();
  for (const c of claims) {
    userIds.add(c.createdById);
    if (c.closedById) userIds.add(c.closedById);
    for (const p of c.participants) userIds.add(p.userId);
  }
  const nameById = await resolveUserNames(userIds);

  return claims.map((c) => ({
    id: c.id,
    claimNumber: c.claimNumber,
    reportedAt: c.reportedAt.toISOString(),
    customerId: c.customerId,
    customerName: c.customer.companyName,
    projectId: c.projectId,
    projectName: c.project?.projectName ?? null,
    contactName: c.contactName,
    contactPhone: c.contactPhone,
    insurer: c.insurer,
    numberPlate: c.numberPlate,
    claimNature: c.claimNature,
    progress: c.progress,
    status: c.status,
    createdById: c.createdById,
    createdByName: nameById.get(c.createdById) ?? "—",
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    closedByName: c.closedById ? (nameById.get(c.closedById) ?? "—") : null,
    closedAt: c.closedAt?.toISOString() ?? null,
    participantNames: c.participants.map((p) => nameById.get(p.userId) ?? "—"),
  }));
}

// Same customerId-merged-alongside-participants contract as getMotorClaims
// above — see that function's doc comment.
export async function getNonMotorClaims(userId: string, customerId?: string): Promise<NonMotorClaimRow[]> {
  const baseWhere = { deletedAt: null, participants: { some: { userId } }, ...(customerId ? { customerId } : {}) } as const;
  const include = {
    customer: { select: { companyName: true } },
    project: { select: { projectName: true } },
    participants: { select: { userId: true } },
  } as const;

  const [open, closed] = await Promise.all([
    prisma.nonMotorClaim.findMany({ where: { ...baseWhere, status: "OPEN" }, include, orderBy: [{ updatedAt: "desc" }, { reportedAt: "desc" }] }),
    prisma.nonMotorClaim.findMany({ where: { ...baseWhere, status: "CLOSED" }, include, orderBy: [{ closedAt: "desc" }, { updatedAt: "desc" }] }),
  ]);
  const claims = [...open, ...closed];

  const userIds = new Set<string>();
  for (const c of claims) {
    userIds.add(c.createdById);
    if (c.closedById) userIds.add(c.closedById);
    for (const p of c.participants) userIds.add(p.userId);
  }
  const nameById = await resolveUserNames(userIds);

  return claims.map((c) => ({
    id: c.id,
    claimNumber: c.claimNumber,
    reportedAt: c.reportedAt.toISOString(),
    customerId: c.customerId,
    customerName: c.customer.companyName,
    projectId: c.projectId,
    projectName: c.project?.projectName ?? null,
    contactName: c.contactName,
    contactPhone: c.contactPhone,
    insurer: c.insurer,
    insuranceType: c.insuranceType,
    progress: c.progress,
    status: c.status,
    createdById: c.createdById,
    createdByName: nameById.get(c.createdById) ?? "—",
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    closedByName: c.closedById ? (nameById.get(c.closedById) ?? "—") : null,
    closedAt: c.closedAt?.toISOString() ?? null,
    participantNames: c.participants.map((p) => nameById.get(p.userId) ?? "—"),
  }));
}

// Assumes the caller already ran checkMotorClaimAccess (or otherwise
// trusts the current viewer is a participant) — this function's own WHERE
// clause still independently re-restricts to non-deleted Claims.
export async function getMotorClaimDetailForDisplay(claimId: string): Promise<MotorClaimDetail | null> {
  const claim = await prisma.motorClaim.findFirst({
    where: { id: claimId, deletedAt: null },
    include: {
      customer: { select: { companyName: true } },
      project: { select: { projectName: true } },
      participants: { orderBy: { addedAt: "asc" } },
      updates: { where: { deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      policyRecord: { select: { id: true, recordNumber: true, category: true } },
      documents: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!claim) return null;

  const userIds = new Set<string>([
    claim.createdById,
    ...claim.participants.map((p) => p.userId),
    ...claim.updates.map((u) => u.createdById),
    ...claim.documents.map((d) => d.uploadedById),
  ]);
  if (claim.closedById) userIds.add(claim.closedById);
  const users = userIds.size ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: USER_SELECT }) : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const nameOf = (id: string) => {
    const u = userById.get(id);
    return u ? u.fullName || u.username : "—";
  };

  const participants: ClaimParticipantRow[] = claim.participants.map((p) => {
    const u = userById.get(p.userId);
    return { userId: p.userId, fullName: u ? u.fullName || u.username : "—", role: u?.role ?? null, isActiveAccount: u?.status === "ACTIVE" };
  });
  const timeline: ClaimTimelineRow[] = claim.updates.map((u) => ({
    id: u.id,
    content: u.content,
    createdById: u.createdById,
    createdByName: nameOf(u.createdById),
    createdAt: u.createdAt.toISOString(),
    editedAt: u.editedAt?.toISOString() ?? null,
    isInitial: u.isInitial,
  }));
  const documents: MotorClaimDocumentRow[] = claim.documents.map((d) => ({
    id: d.id,
    documentType: d.documentType,
    originalFileName: d.originalFileName,
    fileSize: d.fileSize,
    notes: d.notes,
    uploadedByName: nameOf(d.uploadedById),
    createdAt: d.createdAt.toISOString(),
    dropbox: PENDING_DROPBOX_INFO,
  }));

  return {
    id: claim.id,
    claimNumber: claim.claimNumber,
    reportedAt: claim.reportedAt.toISOString(),
    customerId: claim.customerId,
    customerName: claim.customer.companyName,
    projectId: claim.projectId,
    projectName: claim.project?.projectName ?? null,
    contactName: claim.contactName,
    contactPhone: claim.contactPhone,
    insurer: claim.insurer,
    numberPlate: claim.numberPlate,
    claimNature: claim.claimNature,
    progress: claim.progress,
    status: claim.status,
    policyRecordId: claim.policyRecordId,
    linkedPolicy: claim.policyRecord ? { id: claim.policyRecord.id, recordNumber: claim.policyRecord.recordNumber, category: claim.policyRecord.category } : null,
    documents,
    createdById: claim.createdById,
    createdByName: nameOf(claim.createdById),
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
    closedByName: claim.closedById ? nameOf(claim.closedById) : null,
    closedAt: claim.closedAt?.toISOString() ?? null,
    participantNames: participants.map((p) => p.fullName),
    participants,
    timeline,
  };
}

export async function getNonMotorClaimDetailForDisplay(claimId: string): Promise<NonMotorClaimDetail | null> {
  const claim = await prisma.nonMotorClaim.findFirst({
    where: { id: claimId, deletedAt: null },
    include: {
      customer: { select: { companyName: true } },
      project: { select: { projectName: true } },
      participants: { orderBy: { addedAt: "asc" } },
      updates: { where: { deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      policyRecord: { select: { id: true, recordNumber: true, category: true } },
      documents: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!claim) return null;

  const userIds = new Set<string>([
    claim.createdById,
    ...claim.participants.map((p) => p.userId),
    ...claim.updates.map((u) => u.createdById),
    ...claim.documents.map((d) => d.uploadedById),
  ]);
  if (claim.closedById) userIds.add(claim.closedById);
  const users = userIds.size ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: USER_SELECT }) : [];
  const userById = new Map(users.map((u) => [u.id, u]));
  const nameOf = (id: string) => {
    const u = userById.get(id);
    return u ? u.fullName || u.username : "—";
  };

  const participants: ClaimParticipantRow[] = claim.participants.map((p) => {
    const u = userById.get(p.userId);
    return { userId: p.userId, fullName: u ? u.fullName || u.username : "—", role: u?.role ?? null, isActiveAccount: u?.status === "ACTIVE" };
  });
  const timeline: ClaimTimelineRow[] = claim.updates.map((u) => ({
    id: u.id,
    content: u.content,
    createdById: u.createdById,
    createdByName: nameOf(u.createdById),
    createdAt: u.createdAt.toISOString(),
    editedAt: u.editedAt?.toISOString() ?? null,
    isInitial: u.isInitial,
  }));
  const documents: NonMotorClaimDocumentRow[] = claim.documents.map((d) => ({
    id: d.id,
    documentType: d.documentType,
    originalFileName: d.originalFileName,
    fileSize: d.fileSize,
    notes: d.notes,
    uploadedByName: nameOf(d.uploadedById),
    createdAt: d.createdAt.toISOString(),
    dropbox: PENDING_DROPBOX_INFO,
  }));

  return {
    id: claim.id,
    claimNumber: claim.claimNumber,
    reportedAt: claim.reportedAt.toISOString(),
    customerId: claim.customerId,
    customerName: claim.customer.companyName,
    projectId: claim.projectId,
    projectName: claim.project?.projectName ?? null,
    contactName: claim.contactName,
    contactPhone: claim.contactPhone,
    insurer: claim.insurer,
    insuranceType: claim.insuranceType,
    progress: claim.progress,
    status: claim.status,
    policyRecordId: claim.policyRecordId,
    linkedPolicy: claim.policyRecord ? { id: claim.policyRecord.id, recordNumber: claim.policyRecord.recordNumber, category: claim.policyRecord.category } : null,
    documents,
    createdById: claim.createdById,
    createdByName: nameOf(claim.createdById),
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
    closedByName: claim.closedById ? nameOf(claim.closedById) : null,
    closedAt: claim.closedAt?.toISOString() ?? null,
    participantNames: participants.map((p) => p.fullName),
    participants,
    timeline,
  };
}
