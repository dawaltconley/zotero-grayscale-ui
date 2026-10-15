import readerCss from './reader.scss';
import internalPdfReaderCss from './internal-reader-pdf.scss';
import internalReaderCss from './internal-reader.scss';
import {
  isPDFReader,
  isEpubReader,
  isSnapshotReader,
  waitForReader,
  waitForInternalReader,
} from './utils';
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

  #sdtObservers = new Map<string, MutationObserver>();

  async attachStylesToReader(reader: _ZoteroTypes.ReaderInstance) {
    await waitForReader(reader);
    const win = reader._iframeWindow;
    const doc = win?.document;
    if (!win || !doc || !doc.documentElement) {
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

    await waitForInternalReader(reader);
    const internal: Document | undefined =
      // @ts-expect-error -- _iframeWindow is in fact available on all readers
      reader._internalReader._primaryView._iframeWindow?.document;
    if (!internal) {
      this.log("couldn't find internal reader: " + reader.tabID);
      return;
    }

    const stylesInternalReader = doc.createElement('style');
    stylesInternalReader.id = this.stylesId;

    if (isPDFReader(reader)) {
      if (!internal.getElementById(this.stylesId)) {
        stylesInternalReader.innerText = internalPdfReaderCss;
        internal?.documentElement?.appendChild(stylesInternalReader);
      }
      this.log('appended styles to tab: ' + reader.tabID);

      const observer: MutationObserver = new win.MutationObserver(() =>
        this.attachSTDStylesToReader(reader),
      );
      this.#sdtObservers.set(reader.tabID, observer);
      for (const id of ['primary-view', 'secondary-view']) {
        const el = doc.getElementById(id);
        if (el) observer.observe(el, { childList: true });
      }
      await this.attachSTDStylesToReader(reader);
      this.log('appended styles to SDT reader in tab: ' + reader.tabID);
    }

    if (isEpubReader(reader) || isSnapshotReader(reader)) {
      stylesInternalReader.innerText = internalReaderCss;
      // also accessible via reader._internalReader._primaryView._annotationShadowRoot
      const root = internal.getElementById('annotation-overlay')?.shadowRoot;
      if (root && !root.getElementById(this.stylesId)) {
        root?.appendChild(stylesInternalReader);
      }
      this.log('appended styles to tab: ' + reader.tabID);
    }
  }

  async attachSTDStylesToReader(
    reader: _ZoteroTypes.ReaderInstance<'pdf'>,
  ): Promise<void> {
    const view: _ZoteroTypes.Reader.PDFView | undefined =
      /* @ts-expect-error -- _primarySDTView not included in types */
      reader._internalReader._primarySDTView;
    await Promise.resolve(view?.initializedPromise);
    const doc: Document | undefined = view?._iframeWindow?.document;
    if (!view || !doc) {
      this.log("couldn't find SDT reader: " + reader.tabID);
      return;
    }
    const stylesSDTReader = doc.createElement('style');
    stylesSDTReader.id = this.stylesId;
    stylesSDTReader.innerText = internalReaderCss;
    const root = doc.getElementById('annotation-overlay')?.shadowRoot;
    if (root && !root.getElementById(this.stylesId)) {
      root.appendChild(stylesSDTReader);
    }
  }

  async removeStylesFromReader(reader: _ZoteroTypes.ReaderInstance) {
    await waitForReader(reader);
    const doc = reader?._iframeWindow?.document;
    if (!doc) {
      this.log(`couldn't remove styles; tab ${reader.tabID} not ready`);
      return;
    }
    doc.getElementById(this.stylesId)?.remove();

    await waitForInternalReader(reader);
    const internal: Document | undefined =
      // @ts-expect-error -- _iframeWindow is in fact available on all readers
      reader?._internalReader?._primaryView?._iframeWindow?.document;
    if (!internal) {
      this.log("couldn't find internal reader: " + reader.tabID);
      return;
    }

    if (isPDFReader(reader)) {
      internal.getElementById(this.stylesId)?.remove();
    }

    if (isEpubReader(reader) || isSnapshotReader(reader)) {
      const root = internal.getElementById('annotation-overlay')?.shadowRoot;
      root?.getElementById(this.stylesId)?.remove();
    }

    this.#sdtObservers.get(reader.tabID)?.disconnect();

    this.log('removed styles from tab: ' + reader.tabID);
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
                if (reader) {
                  await this.attachStylesToReader(reader);
                }
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
