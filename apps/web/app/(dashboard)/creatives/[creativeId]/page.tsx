import { notFound } from "next/navigation";
import Link from "next/link";
import type { ReactNode } from "react";
import { parseCreativeDetails, parsePlacementBreakdown, type PlacementImpressions } from "@ad-monitor/core";
import { formatAssetKind, formatDate, formatStoreLabel, transparencyCreativeUrl } from "@/components/display";
import { Icons } from "@/components/icons";
import { PageHeader, StatusBadge } from "@/components/shell";
import { getCreative } from "@/lib/data";
import { safeExternalHttpUrl } from "@/lib/media-url";

export default async function CreativeDetailPage({ params }: { params: Promise<{ creativeId: string }> }) {
  const { creativeId } = await params;
  const creative = await getCreative(creativeId);
  if (!creative) notFound();
  const totalPlacementBreakdown = creative.rawDetail ? parseCreativeDetails(creative.rawDetail).totalStats?.placementBreakdown ?? [] : [];

  const storeUrl = safeExternalHttpUrl(creative.app?.storeUrl);
  const creativeTitle = creative.title ?? creative.app?.name ?? "—";
  const creativeDescription = creative.description ?? creative.app?.description ?? "—";

  return (
    <>
      <PageHeader title={creative.creativeId} subtitle={creative.app?.name ?? creative.advertiser?.name ?? "Детали креатива"}>
        <StatusBadge status={creative.status} />
        {creative.advertiser ? (
          <a className="button" href={transparencyCreativeUrl(creative.advertiser.googleAdvertiserId, creative.creativeId)} rel="noreferrer" target="_blank">
            <Icons.ExternalLink size={16} />
            Transparency
          </a>
        ) : null}
        {creative.previewUrl ? (
          <Link prefetch={false} className="button" href={`/preview/${creative.creativeId}`}>
            <Icons.AppWindow size={16} />
            Предпросмотр
          </Link>
        ) : null}
      </PageHeader>

      <section className="grid three-col" style={{ marginBottom: 16 }}>
        <Info label="Приложение" value={creative.app?.appId ?? "Неизвестно"} />
        <Info label="Публичен" value={`${creative.publicDays ?? "—"} дней`} />
        <Info label="Показы" value={formatRange(creative.impressionsMin, creative.impressionsMax)} />
      </section>

      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="panel-header">
          <h2 className="panel-title">Обзор</h2>
        </div>
        <div className="details-grid">
          <InfoLine
            label="Рекламодатель"
            value={creative.advertiser ? <Link prefetch={false} href={`/advertisers/${creative.advertiser.id}`}>{creative.advertiser.name ?? creative.advertiser.googleAdvertiserId}</Link> : "—"}
          />
          <InfoLine
            label="Магазин"
            value={storeUrl ? <a href={storeUrl} rel="noreferrer" target="_blank">{formatStoreLabel(creative.app?.store)}</a> : formatStoreLabel(creative.app?.store)}
          />
          <InfoLine label="Название" value={creativeTitle} />
          <InfoLine label="Описание" value={creativeDescription} />
          <InfoLine label="Первый показ" value={formatDate(creative.firstShownAt)} />
          <InfoLine label="Последний показ" value={formatDate(creative.lastShownAt)} />
          <InfoLine label="Разработчик" value={creative.app?.developer ?? "—"} />
          <InfoLine label="Категория" value={creative.app?.category ?? "—"} />
        </div>
      </section>

      {totalPlacementBreakdown.length ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-header">
            <h2 className="panel-title">Показы по платформам</h2>
          </div>
          <PlacementBreakdownList placements={totalPlacementBreakdown} />
        </section>
      ) : null}

      <section className="grid two-col">
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">География</h2>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Платформы</th>
                <th>Страна</th>
                <th>Показы</th>
                <th>Первый</th>
                <th>Последний</th>
              </tr>
            </thead>
            <tbody>
              {creative.countries.map((country) => (
                <tr key={country.id}>
                  <td><PlacementBreakdownInline placements={parseCountryPlacementBreakdown(country.raw)} /></td>
                  <td>{country.countryCode ?? country.googleGeoId} <span className="muted">{country.countryName}</span></td>
                  <td>{formatRange(country.impressionsMin, country.impressionsMax)}</td>
                  <td>{country.firstShownDate ?? "—"}</td>
                  <td>{country.lastShownDate ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Ассеты</h2>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Тип</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
              {creative.assets.map((asset) => {
                const assetUrl = safeExternalHttpUrl(asset.url);
                return (
                  <tr key={asset.id}>
                    <td>{
                      (() => {
                        try {
                          const url = new URL(asset.url);
                          if (url.hostname === "displayads-formats.googleusercontent.com" && url.pathname === "/ads/preview/content.js") {
                            return "JS";
                          }
                        } catch {}
                        return formatAssetKind(asset.kind);
                      })()
                    }</td>
                    <td>{assetUrl ? <a className="muted" href={assetUrl} rel="noreferrer" target="_blank">{assetUrl.slice(0, 80)}</a> : <span className="muted">{asset.url.slice(0, 80)}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <details className="panel source-details" style={{ marginTop: 16 }}>
        <summary className="panel-title">Данные источника</summary>
        <pre className="raw-box">{JSON.stringify(creative.rawSnapshots ?? [], null, 2)}</pre>
      </details>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="card stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ fontSize: 18 }}>{value}</div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="stat-label">{label}</div>
      <div className="detail-value">{value}</div>
    </div>
  );
}

function parseCountryPlacementBreakdown(raw: unknown) {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  return parsePlacementBreakdown(row["8"]);
}

function PlacementBreakdownList({ placements }: { placements: PlacementImpressions[] }) {
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Платформа</th>
          <th>Показы</th>
        </tr>
      </thead>
      <tbody>
        {placements.map((placement) => (
          <tr key={`${placement.code}-${placement.label}`}>
            <td>{placement.label}</td>
            <td>{formatRange(placement.impressionsMin, placement.impressionsMax)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PlacementBreakdownInline({ placements }: { placements: PlacementImpressions[] }) {
  if (!placements.length) return <span className="muted">-</span>;
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {placements.map((placement) => (
        <span key={`${placement.code}-${placement.label}`}>
          <span className="muted">{placement.label}:</span> {formatRange(placement.impressionsMin, placement.impressionsMax)}
        </span>
      ))}
    </div>
  );
}

function formatRange(min?: number | null, max?: number | null) {
  if (min && max) return `${min.toLocaleString("en-US")} - ${max.toLocaleString("en-US")}`;
  if (max) return `до ${max.toLocaleString("en-US")}`;
  return "—";
}
