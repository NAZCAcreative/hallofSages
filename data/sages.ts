export type SageId = "jesus" | "buddha" | "confucius";

export interface Sage {
  id: SageId;
  name: string;
  subtitle: string;
  portraitImage: string;
  auraClass: string;
}

export const sages: Sage[] = [
  {
    id: "jesus",
    name: "예수",
    subtitle: "빛과 자비의 현자",
    portraitImage: "/images/jejus1.png",
    auraClass: "border-sky-300",
  },
  {
    id: "buddha",
    name: "석가모니",
    subtitle: "고요와 통찰의 현자",
    portraitImage: "/images/buddha.png",
    auraClass: "border-orange-300",
  },
  {
    id: "confucius",
    name: "공자",
    subtitle: "질서와 배움의 현자",
    portraitImage: "/images/confucius.png",
    auraClass: "border-emerald-300",
  },
];

export function getSageById(id: string): Sage | undefined {
  return sages.find((sage) => sage.id === id);
}
