export const SUPPORTED_LOCALES = ['en', 'zh-CN'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: SupportedLocale = 'en';

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: 'English',
  'zh-CN': '简体中文',
};

export type TranslationParams = Record<string, string | number>;

export type TemplateTranslation = {
  name: string;
  description: string;
  layoutLabel: string;
  tags: {
    primary: string;
    secondary: string;
  };
};

type NestedKeyOf<T extends Record<string, unknown>> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends Record<string, unknown>
      ? `${K}.${NestedKeyOf<T[K]>}`
      : never;
}[keyof T & string];

export type TranslationSchema = {
  common: {
    ready: string;
    error: string;
    success: string;
    copy: string;
    download: string;
    preview: string;
    typstSource: string;
    pdf: string;
    source: string;
    save: string;
    select: string;
    current: string;
    checking: string;
  };
  localeSwitcher: {
    label: string;
  };
  tabs: {
    start: string;
    content: string;
    design: string;
    tailor: string;
    export: string;
    preview: string;
    source: string;
  };
  status: {
    idle: string;
    rendering: string;
    ready: string;
    error: string;
    uploading: string;
    extracting: string;
    generating: string;
    success: string;
  };
  editor: {
    eyebrow: string;
  };
  documents: {
    label: string;
    managerLabel: string;
    count: string;
    switchLabel: string;
    switchPlaceholder: string;
    create: string;
    duplicate: string;
    rename: string;
    renameLabel: string;
    renamePlaceholder: string;
    delete: string;
    deleteDisabled: string;
    helper: string;
    localOnlyLabel: string;
    localOnlyDescription: string;
    deleteDialogTitle: string;
    deleteDialogDescription: string;
    deleteDialogCancel: string;
    deleteDialogConfirm: string;
  };
  onboarding: {
    eyebrow: string;
    title: string;
    description: string;
    localOnlyNote: string;
    dismiss: string;
    workflowTitle: string;
    tailorLater: string;
    valueProps: {
      title: string;
      intake: string;
      draft: string;
      export: string;
    };
    actions: {
      startWithSample: string;
      pasteText: string;
      uploadPdf: string;
    };
    workflow: {
      start: string;
      edit: string;
      design: string;
      tailor: string;
      export: string;
    };
    context: {
      contentTitle: string;
      contentDescription: string;
      tailorTitle: string;
      tailorDescription: string;
      exportTitle: string;
      exportDescription: string;
    };
  };
  sections: {
    assistedStart: string;
    paragraphIntake: string;
    pdfIntake: string;
    reviewDraft: string;
    basics: string;
    summary: string;
    experience: string;
    education: string;
    skills: string;
    projects: string;
    template: string;
    typography: string;
    layout: string;
    accent: string;
    exportActions: string;
    snapshots: string;
  };
  fields: {
    resumeTitle: string;
    fullName: string;
    headline: string;
    email: string;
    phone: string;
    location: string;
    website: string;
    linkedin: string;
    github: string;
    role: string;
    company: string;
    start: string;
    end: string;
    school: string;
    degree: string;
    field: string;
    category: string;
    skills: string;
    name: string;
    url: string;
    description: string;
    bullets: string;
    density: string;
    page: string;
  };
  actions: {
    add: string;
    addBullet: string;
    delete: string;
    restore: string;
    generateDraft: string;
    generateDraftFromPages: string;
    choosePdf: string;
    chooseAnotherPdf: string;
    startFromText: string;
    uploadPdf: string;
    startManually: string;
    applyDraft: string;
    editInput: string;
    downloadPdf: string;
    downloadTypst: string;
    copySource: string;
    save: string;
  };
  placeholders: {
    paragraphExample: string;
    fullName: string;
    headline: string;
    email: string;
    phone: string;
    location: string;
    website: string;
    linkedin: string;
    github: string;
    summary: string;
    role: string;
    company: string;
    experienceStart: string;
    experienceEnd: string;
    experienceLocation: string;
    bullet: string;
    school: string;
    educationLocation: string;
    degree: string;
    field: string;
    educationStart: string;
    educationEnd: string;
    skillCategory: string;
    skillItems: string;
    projectName: string;
    projectUrl: string;
    projectDescription: string;
    projectBullet: string;
  };
  intake: {
    usage: {
      startsRemaining: string;
      startsRemainingWithTemplate: string;
      checkingUsage: string;
    };
    cards: {
      startFromTextDescription: string;
      uploadPdfDescription: string;
      startManuallyDescription: string;
    };
    paragraph: {
      sourceMaterial: string;
      attemptsHelper: string;
      minimumLengthError: string;
    };
    pdf: {
      uploadMeta: string;
      uploadTitle: string;
      uploadDescription: string;
      selectedFile: string;
      helper: string;
      invalidFileError: string;
      selectionTitle: string;
      selectionDescription: string;
      pageCount: string;
      pageStartLabel: string;
      pageEndLabel: string;
      pageRangeHelper: string;
      rangeRequiredError: string;
      rangeIntegerError: string;
      rangeOrderError: string;
      rangeBoundsError: string;
    };
    review: {
      confidence: string;
      source: string;
      template: string;
      experience: string;
      education: string;
      skillGroups: string;
      warnings: string;
      documentRisk: string;
      pageRange: string;
      analysisTitle: string;
      pageRangeValue: string;
    };
    sourceKind: {
      pdf: string;
      text: string;
    };
    analysis: {
      singleResume: string;
      likelyPacket: string;
      uncertain: string;
    };
    warningMessages: {
      missingName: string;
      missingEmail: string;
      missingPhone: string;
      missingLocation: string;
      missingSummary: string;
      missingExperience: string;
      missingEducation: string;
      missingSkills: string;
      uncertainDates: string;
      lowConfidenceSection: string;
      modelOutputRepaired: string;
      modelGatewayFailed: string;
      modelGatewayNotConfigured: string;
      pdfLikelyPacket: string;
      pdfMultipleCandidates: string;
      pdfReviewRequired: string;
      pdfUsedOcr: string;
      pdfOcrLowConfidence: string;
    };
    notices: {
      idleText: string;
      idlePdf: string;
      uploading: string;
      extracting: string;
      generatingText: string;
      generatingPdf: string;
      selectionRequired: string;
      errorText: string;
      errorPdf: string;
      successText: string;
      successPdf: string;
    };
  };
  preview: {
    rendering: string;
    renderingError: string;
    renderFailed: string;
    pdfRenderFailed: string;
    startEditing: string;
    zoomIn: string;
    zoomOut: string;
  };
  exportPanel: {
    summaryTitle: string;
    summaryDescription: string;
    activeDocumentTitle: string;
    activeDocumentDescription: string;
    previewDocumentBadge: string;
    ready: string;
    checksWorthReviewing: string;
    documentTitle: string;
    candidateName: string;
    template: string;
    pageSize: string;
    lastUpdated: string;
    fileName: string;
    missingValue: string;
    generatingPdf: string;
    exportedFile: string;
    exportFailed: string;
    pdfPrimaryHelper: string;
    typstHelper: string;
    readinessIssues: {
      missingName: string;
      missingEmail: string;
      emptySummary: string;
      noExperience: string;
      noEducation: string;
      noSkills: string;
    };
  };
  exportReadiness: {
    title: string;
    readyTitle: string;
    needsReviewTitle: string;
    blockedTitle: string;
    scoreLabel: string;
    summary: string;
    needsAttention: string;
    passedChecks: string;
    showAll: string;
    showLess: string;
    exportAnyway: string;
    technicalBlock: string;
    issues: Record<string, { title: string; description: string }>;
    passes: Record<string, string>;
    sections: Record<string, string>;
    severity: Record<string, string>;
  };
  toast: {
    copiedToClipboard: string;
    failedToCopy: string;
    typstDownloaded: string;
    failedToDownload: string;
    pdfDownloaded: string;
    failedToDownloadPdf: string;
    copiedSource: string;
    copyFailed: string;
    downloadFailed: string;
    pdfDownloadFailed: string;
    draftApplied: string;
    tailoredDraftApplied: string;
  };
  tailoring: {
    title: string;
    description: string;
    currentResume: string;
    usage: {
      remaining: string;
    };
    jobDescriptionLabel: string;
    jobDescriptionPlaceholder: string;
    helper: string;
    minimumLengthError: string;
    generate: string;
    generating: string;
    reviewTitle: string;
    reviewDescription: string;
    applyAsNewDocument: string;
    applySelectedAsNewDocument: string;
    acceptedCount: string;
    rejectedCount: string;
    acceptChange: string;
    rejectChange: string;
    selectedDraftPreview: string;
    noAcceptedChanges: string;
    targetRole: string;
    keyRequirements: string;
    matchedStrengths: string;
    gaps: string;
    proposedChanges: string;
    warnings: string;
    notDetected: string;
    noneFound: string;
    noGaps: string;
    noChanges: string;
    changeKinds: {
      rewritten: string;
      reordered: string;
      removed: string;
      emphasized: string;
    };
    warningMessages: {
      gap: string;
      lowConfidence: string;
      noJobDescription: string;
      modelGatewayFailed: string;
      modelGatewayNotConfigured: string;
      outputRepaired: string;
      unsupportedFactRemoved: string;
    };
  };
  empty: {
    experience: string;
    education: string;
    skills: string;
    projects: string;
    snapshots: string;
  };
  meta: {
    identityAndContact: string;
    characters: string;
    layoutSystem: string;
    voiceAndTexture: string;
    densityAndPage: string;
    sourceChars: string;
    sourceMaterial: string;
    pdfUpload: string;
  };
  items: {
    untitledRole: string;
    company: string;
    currentlyWorkingHere: string;
    untitledSchool: string;
    degree: string;
    untitledCategory: string;
    skillsCount: string;
    untitledProject: string;
    project: string;
  };
  design: {
    typography: {
      classic: {
        label: string;
        description: string;
      };
      sans: {
        label: string;
        description: string;
      };
      mono: {
        label: string;
        description: string;
      };
    };
    density: {
      compact: {
        label: string;
        description: string;
      };
      comfortable: {
        label: string;
        description: string;
      };
      spacious: {
        label: string;
        description: string;
      };
    };
    pageSize: {
      letter: {
        label: string;
        description: string;
      };
      a4: {
        label: string;
        description: string;
      };
    };
    accent: {
      signalBlue: string;
      teal: string;
      forest: string;
      amber: string;
      rose: string;
      graphite: string;
    };
  };
  templates: {
    basicResume: TemplateTranslation;
    brilliantCv: TemplateTranslation;
    rendercv: TemplateTranslation;
  };
  document: {
    summary: string;
    experience: string;
    education: string;
    skills: string;
    projects: string;
    present: string;
    educationDegreeConnector: string;
  };
  versionHistory: {
    manualSaveLabel: string;
    templateChangeLabel: string;
    pdfDraftLabel: string;
    paragraphDraftLabel: string;
    restoredLabel: string;
    noSavedSnapshots: string;
  };
};

export type TranslationKey = NestedKeyOf<TranslationSchema>;