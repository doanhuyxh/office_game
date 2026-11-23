import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { SelectField } from '@/components/common/SelectField';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { wikiApi } from '../../api/wiki.api';
import { useWikiMutation } from '../../hooks/useWiki';
import { flattenWikiTree, subtreeHeight, subtreeIds, type IWikiNode } from '../../utils/wiki-tree';

/**
 * Chuyển trang sang trang cha khác (TEST-217): danh sách chọn bỏ chính trang + con cháu và các trang cha làm cây vượt `maxDepth` cấp
 * (server vẫn kiểm). Trang được đặt cuối danh sách của cha mới.
 */
export function WikiMoveDialog({ projectId, node, tree, maxDepth, open, onClose }: {
  projectId: string; node: IWikiNode; tree: IWikiNode[]; maxDepth: number; open: boolean; onClose: () => void;
}) {
  const [parent, setParent] = useState<string | null>(node.page.parentId);
  const [error, setError] = useState<string>();
  const banned = subtreeIds(node);
  const height = subtreeHeight(node);
  const options = flattenWikiTree(tree)
    .filter((n) => !banned.has(n.page.id) && n.depth + height <= maxDepth)
    .map((n) => ({ value: n.page.id, label: `${'— '.repeat(n.depth - 1)}${n.page.title}` }));
  const move = useWikiMutation(projectId, (parentId: string | null) => wikiApi.move(projectId, node.page.id, parentId, 100000));
  const submit = () => {
    setError(undefined);
    move.mutate(parent, {
      onSuccess: () => { toast.success('Đã chuyển trang'); onClose(); },
      onError: (err) => setError(fieldErrors(err).parentId ?? errorMessage(err)),
    });
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-testid="wiki-move-dialog">
        <DialogHeader>
          <DialogTitle>Chuyển trang cha</DialogTitle>
          <DialogDescription>{node.page.title}{node.children.length > 0 && ' — các trang con đi cùng'}</DialogDescription>
        </DialogHeader>
        <SelectField id="wiki-parent" label="Trang cha" value={parent} onChange={setParent} options={options} allowEmpty emptyLabel="— Trang gốc —" error={error} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button className="min-w-24" disabled={parent === node.page.parentId} loading={move.isPending} loadingText="Đang lưu…" onClick={submit}>Chuyển</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
