export type UserRow = {
  id: string;
  username: string;
  fullName: string;
  role: string;
  phoneNumber: string | null;
  permissions: string[];
  status: "ACTIVE" | "DISABLED";
  preferredLanguage: "en" | "zh";
  createdAt: string;
  lastLoginAt: string | null;
};
