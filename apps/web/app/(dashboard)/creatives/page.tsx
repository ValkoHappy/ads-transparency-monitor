import Link from "next/link";
import { AutoFilterForm } from "@/components/auto-filter-form";
import { formatCreativeFormat, formatDate, formatDateTime, formatStoreLabel, transparencyCreativeUrl } from "@/components/display";
import { Icons } from "@/components/icons";
import { PendingButton } from "@/components/pending-button";
import { SelectAllCheckbox } from "@/components/select-all";
import { PageHeader, StatusBadge } from "@/components/shell";
import { getAdvertisers, getCreatives, getCreativesCount } from "@/lib/data";
import { safeExternalHttpUrl } from "@/lib/media-url";

const PAGE_SIZE = 100;

type SearchParams = Record<string, string | undefined>;

export default async function CreativesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const filterParams = {
    advertiserId: params.advertiserId,
    country: params.country,
    status: params.status,
    format: params.format,
    store: params.store,
    appId: params.appId,
    q: params.q,
    activity: params.activity,
    dateField: params.dateField,
    dateFrom: params.dateFrom,
    dateTo: params.dateTo
  };

  const [creatives, total, advertisers] = await Promise.all([
    getCreatives({ ...filterParams, page: String(page), take: PAGE_SIZE }),
    getCreativesCount(filterParams),
    getAdvertisers()
  ]);

  const selectedAdvertiser = advertisers.find((advertiser) => advertiser.id === params.advertiserId || advertiser.googleAdvertiserId === params.advertiserId);
  const exportQuery = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
  const title = selectedAdvertiser ? `Креативы: ${selectedAdvertiser.name ?? selectedAdvertiser.googleAdvertiserId}` : "Креативы";
  const start = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const end = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="creatives-screen">
      <PageHeader title={title} subtitle="Фильтры сохраняются в адресе, список подгружается страницами">
        <a className="button" href={`/export?${exportQuery}`}><Icons.Download size={16} />Экспорт фильтра</a>
        {selectedAdvertiser ? <Link prefetch={false} className="button" href={`/advertisers/${selectedAdvertiser.id}`}>Рекламодатель</Link> : null}
      </PageHeader>

      <section className="panel compact-panel creatives-filter-panel">
        {selectedAdvertiser ? (
          <div className="filter-context">
            <strong>{selectedAdvertiser.name ?? selectedAdvertiser.googleAdvertiserId}</strong>
            <span className="muted">{selectedAdvertiser.googleAdvertiserId}</span>
            <Link prefetch={false} className="button" href="/creatives">Показать всех</Link>
          </div>
        ) : null}
        <AutoFilterForm className="creatives-filter-grid" style={{ marginTop: selectedAdvertiser ? 8 : 0 }}>
          <label className="field-label">Рекламодатель
            <select className="select" name="advertiserId" defaultValue={params.advertiserId ?? ""}>
              <option value="">Все рекламодатели</option>
              {advertisers.map((advertiser) => (
                <option value={advertiser.id} key={advertiser.id}>{advertiser.name ?? advertiser.googleAdvertiserId}</option>
              ))}
            </select>
          </label>
          <label className="field-label">Срез
            <select className="select" name="activity" defaultValue={params.activity ?? "ALL"}>
              <option value="ALL">Все креативы</option>
              <option value="NEW_TODAY">Новые сегодня</option>
              <option value="DISAPPEARED">Пропали</option>
            </select>
          </label>
          <label className="field-label wide">Поиск<input className="input" name="q" placeholder="Креатив или приложение" defaultValue={params.q} /></label>
          <label className="field-label compact">Страна<input className="input" name="country" placeholder="Все" defaultValue={params.country ?? ""} /></label>
          <label className="field-label compact">Статус
            <select className="select" name="status" defaultValue={params.status ?? "ALL"}>
              <option value="ALL">Все</option>
              <option value="ACTIVE">Активные</option>
              <option value="STOPPED">Остановленные</option>
              <option value="UNKNOWN">Неизвестно</option>
            </select>
          </label>
          <label className="field-label compact">Формат
            <select className="select" name="format" defaultValue={params.format ?? "ALL"}>
              <option value="ALL">Все</option>
              <option value="VIDEO">Видео</option>
              <option value="IMAGE">Изображение</option>
              <option value="TEXT">Текст</option>
              <option value="UNKNOWN">Неизвестно</option>
            </select>
          </label>
          <label className="field-label compact">Магазин
            <select className="select" name="store" defaultValue={params.store ?? "ALL"}>
              <option value="ALL">Все</option>
              <option value="GOOGLE_PLAY">Google Play</option>
              <option value="APP_STORE">App Store</option>
              <option value="UNKNOWN">Неизвестно</option>
            </select>
          </label>
          <label className="field-label compact">Дата
            <select className="select" name="dateField" defaultValue={params.dateField ?? "updatedAt"}>
              <option value="updatedAt">Обновление в базе</option>
              <option value="firstFoundAt">Первый сбор</option>
              <option value="lastFoundAt">Последний сбор</option>
              <option value="firstShownAt">Первый показ</option>
              <option value="lastShownAt">Последний показ</option>
              <option value="createdAt">Создан в базе</option>
            </select>
          </label>
          <label className="field-label compact">С<input className="input" type="date" name="dateFrom" defaultValue={params.dateFrom ?? ""} /></label>
          <label className="field-label compact">По<input className="input" type="date" name="dateTo" defaultValue={params.dateTo ?? ""} /></label>
          <a className="button" href={selectedAdvertiser ? `/creatives?advertiserId=${selectedAdvertiser.id}` : "/creatives"}>Сброс</a>
        </AutoFilterForm>
      </section>

      <form className="panel compact-panel creatives-table-panel" action="/api/export/creatives.xlsx" method="get">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Найдено: {total.toLocaleString("en-US")}</h2>
            <p className="page-subtitle">Показаны {start}-{end} из {total.toLocaleString("en-US")}. “Новые сегодня” считается по первому сбору, “Пропали” появляется после полного успешного сбора.</p>
          </div>
          <div className="toolbar">
            <Pagination page={page} total={total} params={params} />
            <PendingButton className="button" pendingText="Готовим Excel" type="submit"><Icons.Download size={16} />Скачать Excel</PendingButton>
          </div>
        </div>
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th><SelectAllCheckbox targetName="creativeIds" /></th>
                <th>№</th>
                <th>Креатив</th>
                <th>Рекламодатель</th>
                <th>Приложение</th>
                <th>Магазин</th>
                <th>Формат</th>
                <th>Страны</th>
                <th>Показы</th>
                <th>Дней</th>
                <th>Первый сбор</th>
                <th>Последний сбор</th>
                <th>Статус</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              {creatives.map((creative, index) => {
                const storeUrl = safeExternalHttpUrl(creative.app?.storeUrl);
                const assetUrl = safeExternalHttpUrl(creative.assets[0]?.url);
                return (
                  <tr key={creative.id}>
                    <td><input type="checkbox" name="creativeIds" value={creative.creativeId} /></td>
                    <td>{(page - 1) * PAGE_SIZE + index + 1}</td>
                    <td><Link prefetch={false} href={`/creatives/${creative.creativeId}`}><strong>{creative.creativeId}</strong></Link></td>
                    <td>{creative.advertiser ? <Link prefetch={false} href={`/advertisers/${creative.advertiser.id}`}>{creative.advertiser.name ?? creative.advertiser.googleAdvertiserId}</Link> : "-"}</td>
                    <td>
                      <strong>{creative.app?.name ?? "Неизвестно"}</strong>
                      <div className="muted">{creative.app?.appId}</div>
                    </td>
                    <td>{formatStoreLabel(creative.app?.store)}</td>
                    <td>{formatCreativeFormat(creative.format)}</td>
                    <td>{creative.countries.slice(0, 4).map((country) => country.countryCode).filter(Boolean).join(", ") || "-"}</td>
                    <td>{formatRange(creative.impressionsMin, creative.impressionsMax)}</td>
                    <td>{creative.publicDays ?? "-"}</td>
                    <td>{formatDate(creative.firstFoundAt)}</td>
                    <td>{formatDateTime(creative.lastFoundAt)}</td>
                    <td><StatusBadge status={creative.status} /></td>
                    <td className="actions-cell">
                      <Link prefetch={false} className="icon-button" href={`/creatives/${creative.creativeId}`} title="Открыть карточку"><Icons.Eye size={16} /></Link>
                      {creative.advertiser ? <a className="icon-button" href={transparencyCreativeUrl(creative.advertiser.googleAdvertiserId, creative.creativeId)} rel="noreferrer" target="_blank" title="Открыть в Transparency Center"><Icons.ExternalLink size={16} /></a> : null}
                      {assetUrl ? <Link prefetch={false} className="icon-button" href={`/preview/${creative.creativeId}`} title="Открыть предпросмотр"><Icons.AppWindow size={16} /></Link> : null}
                      {storeUrl ? <a className="icon-button" href={storeUrl} rel="noreferrer" target="_blank" title="Открыть приложение"><Icons.Download size={16} /></a> : null}
                      {assetUrl ? <a className="icon-button" href={assetUrl} rel="noreferrer" target="_blank" title="Открыть материал"><Icons.Image size={16} /></a> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </form>
    </div>
  );
}

function Pagination({ page, total, params }: { page: number; total: number; params: SearchParams }) {
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const previous = page > 1 ? pageHref(params, page - 1) : undefined;
  const next = page < lastPage ? pageHref(params, page + 1) : undefined;

  return (
    <div className="pagination">
      {previous ? <Link prefetch={false} className="button" href={previous}>Назад</Link> : <span className="button disabled">Назад</span>}
      <span className="pagination-label">{page} / {lastPage}</span>
      {next ? <Link prefetch={false} className="button" href={next}>Дальше</Link> : <span className="button disabled">Дальше</span>}
    </div>
  );
}

function pageHref(params: SearchParams, page: number) {
  const query = new URLSearchParams(Object.entries({ ...params, page: String(page) }).filter((entry): entry is [string, string] => Boolean(entry[1])));
  return `/creatives?${query.toString()}`;
}

function formatRange(min?: number | null, max?: number | null) {
  if (min && max) return `${min.toLocaleString("en-US")} - ${max.toLocaleString("en-US")}`;
  if (max) return `до ${max.toLocaleString("en-US")}`;
  return "-";
}
