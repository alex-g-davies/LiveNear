import type en from "../en/common";

const common: Record<keyof typeof en, string> = {
  "common.language.label": "Dil: {name}",
  "common.englishTag": "(İngilizce)",
  "common.loading": "Yükleniyor…",
  "common.products": "Ürünler",
  "common.backHome": "{name}, ana sayfaya dön",
  "common.meta.description":
    "LiveNear, nerede yaşayabileceğinizi görmeniz için konut değerlerini ve işe gidiş sürelerini haritada gösterir. DriveCheap, Norveç'te araba sahibi olmanın toplam maliyetini gösterir.",
  "common.years_one": "{value} yıl",
  "common.years_other": "{value} yıl",
  "common.months_one": "{value} ay",
  "common.months_other": "{value} ay",
  "common.crash.message": "Bu sayfa yüklenirken bir sorun oluştu.",
  "common.crash.reload": "Yeniden yükleyin",
};

export default common;
