import type en from "../en/common";

const common: Record<keyof typeof en, string> = {
  "common.language.label": "Språk: {name}",
  "common.englishTag": "(engelsk)",
  "common.loading": "Laster inn …",
  "common.products": "Produkter",
  "common.backHome": "{name}, tilbake til forsiden",
  "common.meta.description":
    "LiveNear viser boligpriser og pendlertid på kartet, så du ser hvor du kan bo. DriveCheap viser hva det egentlig koster å eie bil i Norge.",
  "common.years_one": "{value} år",
  "common.years_other": "{value} år",
  "common.months_one": "{value} måned",
  "common.months_other": "{value} måneder",
  "common.crash.message": "Noe gikk galt da siden skulle lastes inn.",
  "common.crash.reload": "Last inn på nytt",
};

export default common;
