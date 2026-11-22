import { useState } from 'react';

export function BrandMark({ size = 28 }: { size?: number }) {
  const [imgFailed, setImgFailed] = useState(false);
  const width = Math.round(size * 1.22);

  if (imgFailed) {
    return (
      <span
        style={{ width, height: size }}
        className="shrink-0 rounded-md overflow-hidden border border-slate-200 inline-flex flex-col"
        aria-hidden="true"
      >
        <span className="flex-1 bg-red-600" />
        <span className="flex-1 bg-white" />
        <span className="flex-1 bg-blue-900" />
      </span>
    );
  }

  return (
    <img
      src="/assets/aistudio/images__1__1959a68c.png"
      alt="New Patriotic Party Emblem"
      width={width}
      height={size}
      style={{ width, height: size }}
      referrerPolicy="no-referrer"
      onError={() => setImgFailed(true)}
      className="shrink-0 rounded-md object-cover border border-slate-200/80 bg-white"
    />
  );
}
