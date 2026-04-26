import readerCss from './reader.scss';
import internalReaderCss from './internal-reader.scss';
import {
  patchAnnotation,
  patchAnnotations,
  toGrayscale,
  type Annotation,
} from './annotations';
import { isPDFReader, waitForReader, waitForInternalReader } from './utils';
import { config, version as packageVersion } from '../package.json';

export interface PluginOptions {
  id: string;
  version: string;
  rootURI: string;
  stylesId?: string;
}

export class Plugin {
  readonly id: string;
  readonly stylesId: string;
  readonly version: string;
  readonly rootURI: string;

  constructor({
    id = config.addonID,
    stylesId = `${config.addonRef}__pluginStyles`,
    version = packageVersion,
    rootURI,
  }: PluginOptions) {
    this.id = id;
    this.stylesId = stylesId;
    this.version = version;
    this.rootURI = rootURI;
  }

  async startup(): Promise<void> {
    this.registerObserver();
    await this.styleExistingTabs();
  }

  async shutdown(): Promise<void> {
    this.unregisterObserver();
    await this.unstyleExistingTabs();
  }

  async attachStylesToReader(reader: _ZoteroTypes.ReaderInstance) {
    await waitForReader(reader);
    const doc = reader?._iframeWindow?.document;
    if (!doc || !doc.documentElement) {
      this.log(`couldn't attach styles; tab ${reader.tabID} not ready`);
      return;
    }
    if (doc.getElementById(this.stylesId)) {
      this.log(`skipping ${reader.tabID}: styles already attached`);
      return;
    }
    const styles = doc.createElement('style');
    styles.id = this.stylesId;
    styles.innerText = readerCss;
    doc.documentElement.appendChild(styles);

    if (isPDFReader(reader)) {
      await waitForInternalReader(reader);
      const internal: Document | undefined =
        reader._internalReader._primaryView._iframeWindow?.document;
      const stylesInternalReader = doc.createElement('style');
      stylesInternalReader.id = this.stylesId;
      stylesInternalReader.innerText = internalReaderCss;
      internal?.documentElement?.appendChild(stylesInternalReader);
      this.log('appended styles to tab: ' + reader.tabID);

      this.monkeyPatchAnnotationRenderer(reader);
      this.log('monkey patched annotation renderer: ' + reader.tabID);
    }
  }

  async removeStylesFromReader(reader: _ZoteroTypes.ReaderInstance) {
    await reader._waitForReader();
    await reader._initPromise;
    const doc = reader?._iframeWindow?.document;
    if (!doc) {
      this.log(`couldn't remove styles; tab ${reader.tabID} not ready`);
      return;
    }
    doc.getElementById(this.stylesId)?.remove();

    const internal: Document | undefined =
      // @ts-expect-error no types for _internalReader._primaryView
      reader?._internalReader?._primaryView?._iframeWindow?.document;
    internal?.getElementById(this.stylesId)?.remove();
  }

  async styleExistingTabs() {
    this.log('adding styles to existing tabs');
    const readers = Zotero.Reader._readers;
    this.log(
      `found ${readers.length} reader tags: ${readers.map((r) => r.tabID).join(', ')}`,
    );
    await Promise.all(readers.map((r) => this.attachStylesToReader(r)));
    this.log('done adding styles to existing tabs');
  }

  async unstyleExistingTabs() {
    this.log('removing styles to existing tabs');
    const readers = Zotero.Reader._readers;
    this.log(
      `found ${readers.length} reader tags: ${readers.map((r) => r.tabID).join(', ')}`,
    );
    await Promise.all(readers.map((r) => this.removeStylesFromReader(r)));
    this.log('done removing styles to existing tabs');
  }

  monkeyPatchAnnotationRenderer(
    reader: _ZoteroTypes.ReaderInstance<'pdf'>,
  ): void {
    const view = reader._primaryView as PDFView;

    monkeyPatchRenderer(view._pages[0]);

    // // Path 1: interactive page rendering (page.js Renderer._renderCommon reads this)
    // const _getPageAnnotations = view._getPageAnnotations.bind(view);
    // view._getPageAnnotations = function (...args) {
    //   const annotations = _getPageAnnotations(...args);
    //   annotations.forEach(applyGrayscale);
    //   return annotations;
    // };
    //
    // // Path 2: thumbnail/print/export rendering
    // const _renderPageAnnotationsOnCanvas =
    //   view.renderPageAnnotationsOnCanvas.bind(view);
    // view.renderPageAnnotationsOnCanvas = async function (...args) {
    //   view._annotations.forEach(applyGrayscale);
    //   try {
    //     await _renderPageAnnotationsOnCanvas(...args);
    //   } finally {
    //     view._annotations.forEach(restoreColor);
    //   }
    // };
  }

  #observerID?: string;
  registerObserver() {
    this.log('registering tab observer');
    if (this.#observerID) {
      throw new Error(`${this.id}: observer is already registered`);
    }
    this.#observerID = Zotero.Notifier.registerObserver(
      {
        notify: async (event, type, ids, extraData) => {
          // @ts-expect-error zotero-types doesn't include 'load' in the event definition, but tabs have a load event
          if ((event === 'add' || event === 'load') && type === 'tab') {
            const tabIDs = ids.filter((id) => extraData[id].type === 'reader');
            await Promise.all(
              tabIDs.map(async (id) => {
                const reader = Zotero.Reader.getByTabID(id.toString());
                await this.attachStylesToReader(reader);
              }),
            );
          }
        },
      },
      ['tab'],
    );
    this.log('registered observer: ' + this.#observerID);
  }

  unregisterObserver() {
    if (this.#observerID) {
      this.log('unregistering observer: ' + this.#observerID);
      Zotero.Notifier.unregisterObserver(this.#observerID);
      this.#observerID = undefined;
    }
  }

  log(msg: string) {
    Zotero.debug(`[${config.addonName}] ${msg}`, 1);
  }
}

interface PDFView extends _ZoteroTypes.Reader.PDFView {
  renderPageAnnotationsOnCanvas: (
    canvas: HTMLCanvasElement,
    viewport: unknown,
    pageIndex: number,
  ) => Promise<void>;
  _getPageAnnotations?: (pageIndex: number) => Annotation[];
  _render: (pageIndexes?: number[]) => void;
  _annotations: Annotation[];
  _pages: Page[];
}

interface Page extends _ZoteroTypes.Reader.Page {
  _layer: PDFView;
  _pageIndex: number;
  _originalPage: unknown;
  _pageRenderer: Renderer;
  _detailRenderer: Renderer;
  refresh(detailView: boolean): void;
  render(): void;
  renderAnnotationOnCanvas(
    annotation: Annotation,
    canvas: HTMLCanvasElement,
  ): void;
}

interface Renderer {
  _isDetailView: boolean;
  _layer: PDFView;
  _originalPage: unknown;
  _pageIndex: number;
  _snapshotCanvas: HTMLCanvasElement;
  _snapshotContext: CanvasRenderingContext2D;
  _context: CanvasRenderingContext2D | null;
  _lastSourceCanvas: HTMLCanvasElement | null;
  _lastSourceSize: { w: number; h: number };
  _lastRenderSignature: string | null;
  _isRendering: boolean;
  readonly _transform: number[];
  readonly _scale: number;
  _getSourceCanvas(): HTMLCanvasElement | undefined;
  _initContext(): void;
  _invalidateSignature(): void;
  _maybeRefreshSnapshot(): void;
  _getViewPoint(p: number[], tfm?: number[]): number[];
  _getPdfPoint(p: number[]): number[];
  _getViewRect(rect: number[], tfm?: number[]): number[];
  _buildRenderSignature(): string;
  _drawHover(): void;
  _drawOverlays(): void;
  _drawNoteIcon(ctx: CanvasRenderingContext2D, color: string): void;
  _drawCommentIcons(annotations: Annotation[]): void;
  _drawHighlight(annotation: Annotation): void;
  _drawUnderline(annotation: Annotation): void;
  _drawNote(annotation: Annotation): void;
  _drawImage(annotation: Annotation): void;
  _drawInk(annotation: Annotation): void;
  _drawFindResults(): void;
  _renderCommon(): void;
  render(): void;
  renderAnnotationOnCanvas(
    annotation: Annotation,
    canvas: HTMLCanvasElement,
  ): void;
}

function monkeyPatchRenderer(page: Page): void {
  const proto: Renderer = Object.getPrototypeOf(page._pageRenderer);

  const _drawHighlight = proto._drawHighlight;
  proto._drawHighlight = function (annotation, ...args) {
    patchAnnotation(annotation, (patched) => {
      _drawHighlight.call(this, patched, ...args);
    });
  };

  const _drawUnderline = proto._drawUnderline;
  proto._drawUnderline = function (annotation, ...args) {
    patchAnnotation(annotation, (patched) => {
      _drawUnderline.call(this, patched, ...args);
    });
  };

  const _drawNote = proto._drawNote;
  proto._drawNote = function (annotation, ...args) {
    patchAnnotation(annotation, (patched) => {
      _drawNote.call(this, patched, ...args);
    });
  };

  const _drawImage = proto._drawImage;
  proto._drawImage = function (annotation, ...args) {
    patchAnnotation(annotation, (patched) => {
      _drawImage.call(this, patched, ...args);
    });
  };

  const _drawInk = proto._drawInk;
  proto._drawInk = function (annotation, ...args) {
    patchAnnotation(annotation, (patched) => {
      _drawInk.call(this, patched, ...args);
    });
  };

  const _drawCommentIcons = proto._drawCommentIcons;
  proto._drawCommentIcons = function (annotations, ...args) {
    patchAnnotations(annotations, (patched) => {
      _drawCommentIcons.call(this, patched, ...args);
    });
  };

  const _drawNoteIcon = proto._drawNoteIcon;
  proto._drawNoteIcon = function (canvas, color, ...args) {
    _drawNoteIcon.call(this, canvas, toGrayscale(color), ...args);
  };

  const renderAnnotationOnCanvas = proto.renderAnnotationOnCanvas;
  proto.renderAnnotationOnCanvas = function (annotation, ...args) {
    patchAnnotation(annotation, (patched) => {
      renderAnnotationOnCanvas.call(this, patched, ...args);
    });
  };
}
