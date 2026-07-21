import { ChatBubbleLeftIcon } from '@heroicons/react/24/outline';
import {
  BrowserAnnotationAnchorKind,
  type BrowserAnnotationScreenshotRef,
  BrowserAnnotationScreenshotStatus,
  type CoworkBrowserAnnotationBatch,
} from '@shared/cowork/browserAnnotations';
import * as Popover from '@radix-ui/react-popover';
import React, { useEffect, useMemo, useState } from 'react';

import { i18nService } from '../../services/i18n';
import XMarkIcon from '../icons/XMarkIcon';

interface BrowserAnnotationAttachmentBadgeProps {
  draftKey: string;
  batches: CoworkBrowserAnnotationBatch[];
  onClear?: () => void;
  readOnly?: boolean;
}


const AnnotationThumbnail: React.FC<{
  draftKey: string;
  batch: CoworkBrowserAnnotationBatch;
  annotationId: string;
  asset?: BrowserAnnotationScreenshotRef;
  index: number;
}> = ({ draftKey, batch, annotationId, asset, index }) => {
  const [src, setSrc] = useState('');
  const assetId = asset?.assetId;
  const previewDataUrl = asset?.previewDataUrl;
  useEffect(() => {
    let alive = true;
    if (previewDataUrl) {
      setSrc(previewDataUrl);
      return () => { alive = false; };
    }
    if (!assetId) return undefined;
    const readAsset = window.electron?.artifact?.readBrowserAnnotationAsset;
    if (!readAsset) return undefined;
    const scopedDraftKeys = Array.from(new Set([
      batch.assetDraftKey || draftKey,
      draftKey,
      '__home__',
    ].filter(Boolean)));
    void (async () => {
      for (const scopedDraftKey of scopedDraftKeys) {
        const result = await readAsset({
          draftKey: scopedDraftKey,
          batchId: batch.id,
          annotationId,
          assetId,
        });
        if (alive && result?.success && result.dataUrl) {
          setSrc(result.dataUrl);
          return;
        }
      }
    })();
    return () => { alive = false; };
  }, [annotationId, assetId, previewDataUrl, batch.assetDraftKey, batch.id, draftKey]);
  return (
    <div className="relative h-11 w-14 shrink-0 overflow-hidden rounded-lg border border-border bg-background shadow-subtle">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="h-full w-full bg-surface-raised" />
      )}
      <span className="absolute left-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground shadow-sm">
        {index}
      </span>
    </div>
  );
};

const BrowserAnnotationAttachmentBadge: React.FC<BrowserAnnotationAttachmentBadgeProps> = ({
  draftKey,
  batches,
  onClear,
  readOnly = false,
}) => {
  const [open, setOpen] = useState(false);
  const annotations = useMemo(() => batches.flatMap(batch => (
    batch.annotations.map(annotation => ({ batch, annotation }))
  )), [batches]);
  if (annotations.length === 0) return null;
  const popoverContent = (
    <Popover.Content
      side="top"
      align="end"
      sideOffset={8}
      collisionPadding={16}
      className="z-[1000] w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-xl border border-border bg-surface shadow-popover animate-scale-in"
    >
      <div className="flex h-10 items-center justify-between border-b border-border px-3">
        <div className="min-w-0 truncate text-sm font-medium text-foreground">
          {i18nService.t('browserAnnotationsTitle')}
        </div>
        {!readOnly && onClear ? (
          <button
            type="button"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            aria-label={i18nService.t('browserAnnotationsClear')}
            title={i18nService.t('browserAnnotationsClear')}
            onClick={() => {
              onClear();
              setOpen(false);
            }}
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className="max-h-72 overflow-y-auto p-2">
        <div className="flex flex-col gap-1.5">
          {annotations.map(({ batch, annotation }, index) => {
            const target = annotation.anchor.kind === BrowserAnnotationAnchorKind.Element
              ? annotation.anchor.tagName
              : i18nService.t(`browserAnnotationTarget_${annotation.anchor.kind}`);
            const pageLabel = batch.pageTitle || batch.pageUrl;
            return (
              <div
                key={annotation.id}
                className="flex min-w-0 items-start gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-raised/70"
                title={[pageLabel, target, annotation.comment].filter(Boolean).join('\n')}
              >
                <AnnotationThumbnail
                  draftKey={draftKey}
                  batch={batch}
                  annotationId={annotation.id}
                  asset={annotation.screenshot.status === BrowserAnnotationScreenshotStatus.Ready
                    ? annotation.screenshot.asset
                    : undefined}
                  index={index + 1}
                />
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted">
                    <span className="shrink-0 font-medium text-secondary">{target}</span>
                    {pageLabel ? (
                      <>
                        <span className="shrink-0 text-muted/60">·</span>
                        <span className="min-w-0 truncate">{pageLabel}</span>
                      </>
                    ) : null}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[13px] leading-5 text-foreground">
                    {annotation.comment}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Popover.Content>
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div className={`group inline-flex h-8 items-center rounded-full border border-border text-xs text-foreground shadow-subtle transition-colors ${
        open ? 'bg-surface-raised' : 'bg-surface hover:bg-surface-raised/70'
      }`}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className="inline-flex h-full items-center gap-1.5 rounded-full pl-3 pr-2"
            aria-expanded={open}
          >
            <ChatBubbleLeftIcon className="h-3.5 w-3.5 text-primary" />
            <span className="whitespace-nowrap">
              {i18nService.t('browserAnnotationsCount').replace('{count}', String(annotations.length))}
            </span>
          </button>
        </Popover.Trigger>
        {!readOnly && onClear ? (
          <button
            type="button"
            className="mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted opacity-0 transition-all hover:bg-surface hover:text-foreground group-hover:opacity-100 group-focus-within:opacity-100"
            aria-label={i18nService.t('browserAnnotationsClear')}
            onClick={event => {
              event.stopPropagation();
              onClear();
              setOpen(false);
            }}
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      <Popover.Portal>
        {popoverContent}
      </Popover.Portal>
    </Popover.Root>
  );
};

export default BrowserAnnotationAttachmentBadge;
