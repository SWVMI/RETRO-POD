"use client";

import { motion } from "motion/react";
import { Music } from "lucide-react";

export type CoverflowItem = {
  id: string;
  name: string;
  artworkUrl?: string;
};

type Props = {
  items: CoverflowItem[];
  activeIndex: number;
  isPlaying: boolean;
};

const SIDE_SPAN = 2;

function circularOffset(index: number, active: number, count: number) {
  if (count === 0) return 0;
  let diff = index - active;
  const half = count / 2;
  if (diff > half) diff -= count;
  if (diff < -half) diff += count;
  return diff;
}

function cardStyle(offset: number) {
  const abs = Math.abs(offset);
  const dir = Math.sign(offset);
  return {
    x: offset * 52,
    scale: 1 - abs * 0.22,
    rotateY: -dir * abs * 32,
    opacity: abs > SIDE_SPAN ? 0 : 1 - abs * 0.3,
    zIndex: 50 - abs,
  };
}

export default function AlbumCoverflow({ items, activeIndex, isPlaying }: Props) {
  if (items.length === 0) {
    return (
      <div className={`w-24 h-24 rounded-xl bg-black/20 border-2 border-current shadow-2xl flex items-center justify-center overflow-hidden relative z-20`}>
        <div className="flex flex-col items-center justify-center text-current/60 relative z-10">
          <Music size={32} />
          <span className="text-[9px] uppercase font-bold mt-1 tracking-widest">No Art</span>
        </div>
      </div>
    );
  }

  const count = items.length;
  const visible = items
    .map((item, index) => ({ item, index, offset: circularOffset(index, activeIndex, count) }))
    .filter(({ offset }) => Math.abs(offset) <= SIDE_SPAN);

  return (
    <div className="relative w-full h-full flex items-center justify-center" style={{ perspective: 700 }}>
      {visible.map(({ item, offset }) => {
        const style = cardStyle(offset);
        const isActive = offset === 0;
        return (
          <motion.div
            key={item.id}
            initial={false}
            animate={{ x: style.x, scale: style.scale, rotateY: style.rotateY, opacity: style.opacity }}
            transition={{ type: "spring", stiffness: 260, damping: 28 }}
            style={{ zIndex: style.zIndex }}
            className={`absolute w-24 h-24 rounded-xl bg-black/20 border-2 border-current shadow-2xl flex items-center justify-center overflow-hidden ${
              isActive ? "" : "pointer-events-none"
            }`}
          >
            {item.artworkUrl ? (
              <motion.img
                animate={isActive && isPlaying ? { scale: [1, 1.03, 1] } : { scale: 1 }}
                transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
                src={item.artworkUrl}
                className="absolute inset-0 w-full h-full object-cover"
                alt={item.name}
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-current/60 relative z-10">
                <Music size={isActive ? 32 : 20} />
                {isActive && <span className="text-[9px] uppercase font-bold mt-1 tracking-widest">No Art</span>}
              </div>
            )}
            {!isActive && <div className="absolute inset-0 bg-black/40" />}
          </motion.div>
        );
      })}
    </div>
  );
}