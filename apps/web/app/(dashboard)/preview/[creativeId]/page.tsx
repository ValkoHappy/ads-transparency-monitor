import Link from "next/link";
import { notFound } from "next/navigation";
import { Icons } from "@/components/icons";
import { PreviewGallery } from "@/components/preview-gallery";
import { PageHeader } from "@/components/shell";
import { getCreative } from "@/lib/data";
import { isPreviewMediaAsset, safeExternalHttpUrl } from "@/lib/media-url";

export default async function CreativePreviewPage({ params }: { params: Promise<{ creativeId: string }> }) {
  const { creativeId } = await params;
  const creative = await getCreative(creativeId);
  if (!creative) notFound();

  const assets = [
    ...creative.assets.filter((asset) => asset.kind === "VIDEO" && isPreviewMediaAsset(asset)),
    ...creative.assets.filter((asset) => asset.kind !== "VIDEO" && isPreviewMediaAsset(asset))
  ];
  const landing = creative.assets.find((asset) => asset.kind === "LANDING_URL");
  const landingUrl = safeExternalHttpUrl(landing?.url);

  return (
    <div className="preview-screen">
      <PageHeader title={`Предпросмотр: ${creative.creativeId}`} subtitle={creative.app?.name ?? creative.advertiser?.name ?? "Креатив Google Ads"}>
        <Link prefetch={false} className="button" href={`/creatives/${creative.creativeId}`}>
          <Icons.AppWindow size={16} />
          Карточка
        </Link>
        {landingUrl ? <a className="button" href={landingUrl} rel="noreferrer" target="_blank">Открыть ссылку</a> : null}
      </PageHeader>

      <section className="panel preview-media-panel preview-media-panel-wide">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Медиа из базы</h2>
            <div className="muted chart-subtitle">Показываем сохраненные изображения и видео из detail/preview. Google render скрыт из интерфейса.</div>
          </div>
          <span className="status-chip">{assets.length} файлов</span>
        </div>

        <PreviewGallery assets={assets} creativeId={creative.creativeId} />
      </section>
    </div>
  );
}
