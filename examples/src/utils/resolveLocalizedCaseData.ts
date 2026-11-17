import { test } from '@playwright/test';

export function resolveLocalizedCaseData<Shared extends object, Local extends object>(
  entry: Shared & { locales: Record<string, Local> },
) {
  const { locales, ...shared } = entry;
  const { project, title } = test.info();
  const language = project.use.locale;
  const localized = language ? locales[language] : undefined;

  if (!localized) {
    throw new Error(`${title}: missing test data for "${language ?? 'unset'}".`);
  }

  return { ...shared, ...localized };
}
