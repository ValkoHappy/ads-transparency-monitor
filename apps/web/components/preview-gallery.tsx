/* eslint-disable @next/next/no-img-element */
"use client";

import { useMemo, useState } from "react";
import { isPreviewMediaAsset, safeExternalHttpUrl } from "@/lib/media-url";

type PreviewAsset = {
  id: string;
  kind: string;
  url: string;
};

export function PreviewGallery({ assets, creativeId }: { assets: PreviewAsset[]; creativeId: string }) {
  const items = useMemo(() => assets
    .filter(isPreviewMediaAsset)
    .map((asset) => ({ ...asset, url: safeExternalHttpUrl(asset.url) ?? "" }))
    .filter((asset) => asset.url), [assets]);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = items[activeIndex];

  if (!items.length) {
    return (
      <div className="empty-state preview-empty">
        <strong>Медиа для этого креатива пока нет.</strong>
        <p className="muted">Сервис не нашел сохраненных изображений или видео. После следующего сбора здесь появятся материалы из базы.</p>
      </div>
    );
  }

  function go(direction: number) {
    setActiveIndex((current) => (current + direction + items.length) % items.length);
  }

  return (
    <div className="preview-gallery">
      <div className="preview-media-stage preview-media-stage-wide">
        {items.length > 1 ? (
          <>
            <button className="gallery-nav gallery-nav-prev" type="button" onClick={() => go(-1)} aria-label="Предыдущее медиа">&lt;</button>
            <button className="gallery-nav gallery-nav-next" type="button" onClick={() => go(1)} aria-label="Следующее медиа">&gt;</button>
          </>
        ) : null}

        <div className="preview-active-counter">{activeIndex + 1} / {items.length}</div>

        {active.kind === "VIDEO" ? (
          <video className="preview-video" src={active.url} controls playsInline preload="metadata" />
        ) : (
          <img className="preview-image" src={active.url} alt={`${creativeId} ${activeIndex + 1}`} />
        )}
      </div>

      {items.length > 1 ? (
        <div className="preview-thumbs" role="list" aria-label="Миниатюры медиа">
          {items.map((asset, index) => (
            <button
              aria-current={index === activeIndex ? "true" : undefined}
              aria-label={`Показать медиа ${index + 1}`}
              className={`preview-thumb ${index === activeIndex ? "active" : ""}`}
              key={asset.id}
              onClick={() => setActiveIndex(index)}
              type="button"
            >
              {asset.kind === "VIDEO" ? (
                <span className="preview-thumb-video">Видео</span>
              ) : (
                <img src={asset.url} alt={`${asset.kind} ${index + 1}`} />
              )}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
