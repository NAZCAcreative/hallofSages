import type { SageId } from "@/data/sages";

export interface Room {
  id: string;
  sageId: SageId;
  title: string;
  direction: string;
  description: string;
  backgroundImage: string;
  overlayClass: string;
}

export const rooms: Room[] = [
  {
    id: "jesus-room",
    sageId: "jesus",
    title: "촛불의 예배당",
    direction: "North Gate",
    description: "차가운 석벽 사이로 금빛 스테인드글라스가 흔들리고, 낮은 촛불이 방의 중심을 밝힙니다.",
    backgroundImage: "/images/jesus-room.png",
    overlayClass: "bg-sky-950/35",
  },
  {
    id: "buddha-room",
    sageId: "buddha",
    title: "연꽃의 명상실",
    direction: "West Gate",
    description: "희미한 향연과 연꽃 문양이 어둠 속에서 떠오르고, 방 안의 소리는 천천히 가라앉습니다.",
    backgroundImage: "/images/buddha-room.png",
    overlayClass: "bg-orange-950/35",
  },
  {
    id: "confucius-room",
    sageId: "confucius",
    title: "대나무 서고",
    direction: "East Gate",
    description: "낡은 목재 선반과 대나무 그림자가 겹쳐지고, 오래된 문장의 기운이 바닥에 내려앉아 있습니다.",
    backgroundImage: "/images/confucius-room.png",
    overlayClass: "bg-emerald-950/35",
  },
];
