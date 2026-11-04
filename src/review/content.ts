import * as vscode from 'vscode';

import { decodeBaseQuery, encodeBaseQuery, queryToTarget } from './reviewModel';
import type { ReviewFile, ReviewService, ReviewTarget } from './types';

/** Scheme of read-only documents with the base version of a changed file. */
export const REVIEW_BASE_SCHEME = 'zedlayout-review';

/** URI of the base (left) side of a change: `zedlayout-review:/<path>?<json>`. */
export function baseUri(sessionId: string, target: ReviewTarget, file: ReviewFile): vscode.Uri {
  return vscode.Uri.from({
    scheme: REVIEW_BASE_SCHEME,
    path: `/${file.originalPath ?? file.path}`,
    query: encodeBaseQuery(sessionId, target, file),
  });
}

/** Working-tree (right) side of a change. */
export function workingUri(target: ReviewTarget, file: ReviewFile): vscode.Uri {
  return vscode.Uri.joinPath(vscode.Uri.file(target.root), ...file.path.split('/'));
}

/** Serves `ReviewService.baseContent` for `zedlayout-review:` URIs. */
export class ReviewBaseContentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly service: ReviewService) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    if (!uri.query || uri.query === 'empty') {
      return '';
    }
    const query = decodeBaseQuery(uri.query);
    if (!query) {
      return '';
    }
    const { target, file } = queryToTarget(query);
    try {
      return (await this.service.baseContent(target, file)) ?? '';
    } catch {
      return '';
    }
  }
}
