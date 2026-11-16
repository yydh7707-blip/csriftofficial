export type AppLanguage = 'en' | 'ko' | 'ja'
export type OnboardingStep = 'language' | 'legal' | 'steam' | 'intro' | 'complete'
export type LegalConsent = {
  privacyVersion: string
  termsVersion: string
  consentedAt: string
  language: AppLanguage
}
export type OnboardingProgress = {
  language: AppLanguage | null
  step: OnboardingStep
  completed: boolean
  consent: LegalConsent | null
}

export const LEGAL_VERSION = '2026-11-16'
export const ONBOARDING_STORAGE_KEY = 'csrift-first-launch-onboarding-v1'

export const initialOnboarding: OnboardingProgress = {
  language: null,
  step: 'language',
  completed: false,
  consent: null,
}

export function readOnboarding(): OnboardingProgress {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY) ?? 'null')
    if (!value || typeof value !== 'object') return initialOnboarding
    const saved = value as Partial<OnboardingProgress>
    const language = saved.language === 'en' || saved.language === 'ko' || saved.language === 'ja' ? saved.language : null
    const steps: OnboardingStep[] = ['language', 'legal', 'steam', 'intro', 'complete']
    const step = steps.includes(saved.step as OnboardingStep) ? saved.step as OnboardingStep : 'language'
    const completed = saved.completed === true && step === 'complete' && Boolean(language)
    const storedConsent = saved.consent as Partial<LegalConsent> | null | undefined
    const consent = storedConsent
      && storedConsent.privacyVersion === LEGAL_VERSION
      && storedConsent.termsVersion === LEGAL_VERSION
      && typeof storedConsent.consentedAt === 'string'
      && (storedConsent.language === 'en' || storedConsent.language === 'ko' || storedConsent.language === 'ja')
      ? storedConsent as LegalConsent
      : null
    if (!completed && step !== 'language' && !language) return initialOnboarding
    if (['steam', 'intro', 'complete'].includes(step) && !consent) return { ...initialOnboarding, language, step: 'legal' }
    return { language, step: step === 'complete' && !completed ? 'intro' : step, completed, consent }
  } catch {
    return initialOnboarding
  }
}
