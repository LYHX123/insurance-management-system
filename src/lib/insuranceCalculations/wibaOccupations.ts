// Single source of truth for the WIBA Occupation combobox's preset list
// (components/quotations/sections/WIBASection.tsx). Sorted A-Z — do not
// list these in any other order; add new occupations anywhere in the array
// below, the sort happens at module load.
const RAW_WIBA_OCCUPATIONS = [
  "Carpenter",
  "Director",
  "Driver",
  "Electrician",
  "Engineer",
  "Foreman",
  "General Labor",
  "General Office Staff",
  "House Keeper",
  "HR Manager",
  "Manager",
  "Mason",
  "Mechanic",
  "Operator",
  "Plumber",
  "Safety Officer",
  "Scaffolder",
  "Security",
  "Steel Fixer",
  "Surveyor",
  "Welder",
];

export const WIBA_OCCUPATIONS: readonly string[] = [...RAW_WIBA_OCCUPATIONS].sort((a, b) =>
  a.localeCompare(b)
);
