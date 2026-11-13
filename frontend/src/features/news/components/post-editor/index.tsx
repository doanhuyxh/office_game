import { useEffect, useRef, useState } from 'react';
import { promptDialog } from '@/components/common/confirm-dialog';
import { EditorContent, Node as TiptapNode, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { AtSign, Bold, Heading2, Italic, Link2, List, ListOrdered, Quote, Smile, Underline as UnderlineIcon, Unlink } from 'lucide-react';
import { Button } from '@/components/common/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/common/dropdown-menu';
import { MentionList, type IMentionOption } from '@/components/common/mention-list';
import { useDebounce } from '@/hooks/useDebounce';
import { useMentionNav } from '@/hooks/useMentionNav';
import { cn } from '@/utils/cn';
import { MENTION_MAX_CHARS, mentionHint, nextMentionQuery } from '@/utils/mention';
import { usePeople } from '../../hooks/useNews';
import { EMOJIS, MAX_POST_CHARS } from '../../utils/labels';
import '../rich-content/rich-content.css';

/** Người được @nhắc: span[data-mention=<userId>] (BE chỉ giữ thuộc tính khi là Guid). */
const Mention = TiptapNode.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  addAttributes() {
    return { id: { default: null }, label: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'span[data-mention]', getAttrs: (el) => ({ id: (el as HTMLElement).getAttribute('data-mention'), label: (el as HTMLElement).textContent?.replace(/^@/, '') ?? '' }) }];
  },
  renderHTML({ node }) {
    return ['span', { 'data-mention': node.attrs.id }, `@${node.attrs.label}`];
  },
  renderText({ node }) {
    return `@${node.attrs.label}`;
  },
});

/** Từ khoá @nhắc ngay trước con trỏ + vị trí dấu @ trong tài liệu, hoặc null. `prev` = từ khoá đang mở (cho phép gõ họ tên có dấu cách). */
function editorMentionQuery(editor: Editor, prev: string | null): { query: string; from: number } | null {
  const { $from, empty } = editor.state.selection;
  if (!empty) return null;
  const query = nextMentionQuery($from.parent.textBetween(Math.max(0, $from.parentOffset - MENTION_MAX_CHARS - 5), $from.parentOffset, undefined, '￼'), prev);
  return query !== null ? { query, from: $from.pos - query.length - 1 } : null;
}

/** Trình soạn thảo bài viết (Tiptap): đậm / nghiêng / gạch chân / tiêu đề / danh sách / trích dẫn / link / emoji / @nhắc. Ảnh, video, tệp đính kèm đi riêng (không chèn vào thân bài). */
export function PostEditor({ value, onChange, placeholder = 'Bạn muốn chia sẻ điều gì?', autoFocus }: {
  value: string;
  onChange: (html: string, plain: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [mention, setMention] = useState<{ query: string; from: number } | null>(null);
  const term = useDebounce(mention?.query ?? '', 200);
  const people = usePeople(term, mention !== null);
  const loading = mention !== null && (term !== mention.query || people.isFetching);
  const found: IMentionOption[] = mention
    ? (people.data ?? []).map((p) => ({ key: p.userId, name: p.fullName, hint: mentionHint(p.code, p.departmentName, p.title), avatarUrl: p.avatarUrl, isBot: p.isBot }))
    : [];
  // Gõ họ tên có dấu cách mà không còn ai khớp → đóng gợi ý
  const live = mention && mention.query.includes(' ') && !loading && found.length === 0 ? null : mention;
  const list = live ? found : [];
  const nav = useMentionNav(list, (p) => pick(p), () => setMention(null));
  const mentionRef = useRef(live);
  mentionRef.current = live;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, code: false, horizontalRule: false, link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' } } }),
      Placeholder.configure({ placeholder }),
      Mention,
    ],
    content: value,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: { class: 'news-rich news-editor min-h-32 max-h-[50vh] overflow-y-auto px-3 py-2 outline-none', 'data-testid': 'post-editor' },
      handleKeyDown: (_view, e) => nav.handleKey(e),
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.isEmpty ? '' : ed.getHTML(), ed.getText({ blockSeparator: '\n' }).trim());
      setMention(editorMentionQuery(ed, mentionRef.current?.query ?? null));
      nav.setActive(0);
    },
    onSelectionUpdate: ({ editor: ed }) => setMention(editorMentionQuery(ed, mentionRef.current?.query ?? null)),
  });

  // Nội dung đổi từ ngoài (mở lại hộp soạn khác) → nạp lại
  useEffect(() => {
    if (editor && value !== (editor.isEmpty ? '' : editor.getHTML())) editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  function pick(p: IMentionOption) {
    const m = mentionRef.current;
    if (!editor || !m) return;
    editor.chain().focus().deleteRange({ from: m.from, to: editor.state.selection.from })
      .insertContent([{ type: 'mention', attrs: { id: p.key, label: p.name } }, { type: 'text', text: ' ' }]).run();
    setMention(null);
  }

  if (!editor) return null;
  const chars = editor.getText().length;
  return (
    <div className="rounded-md border border-input focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
      <Toolbar editor={editor} />
      <div className="relative" data-mention-open={live !== null || undefined}>
        <EditorContent editor={editor} />
        <MentionList options={list} active={nav.active} onPick={pick} onHover={nav.setActive} query={live?.query ?? ''} loading={loading} open={live !== null}
          className="absolute bottom-1 left-2" />
      </div>
      <div className={cn('border-t px-3 py-1 text-right text-xs text-muted-foreground', chars > MAX_POST_CHARS && 'text-destructive')}>
        {chars.toLocaleString('vi-VN')} / {MAX_POST_CHARS.toLocaleString('vi-VN')}
      </div>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const btn = (label: string, active: boolean, run: () => void, icon: React.ReactNode) => (
    <Button type="button" variant={active ? 'secondary' : 'ghost'} size="icon-sm" aria-label={label} title={label} aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()} onClick={run}>
      {icon}
    </Button>
  );
  async function setLink() {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = await promptDialog({ title: 'Chèn liên kết', label: 'Địa chỉ liên kết', placeholder: 'https://…', initial: prev ?? 'https://',
      description: 'Để trống để bỏ liên kết.', confirmText: 'Lưu' });
    if (url === null) return;
    if (url.trim() === '' || url.trim() === 'https://') { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().extendMarkRange('link').setLink({ href: /^(https?:|mailto:|tel:)/i.test(url.trim()) ? url.trim() : `https://${url.trim()}` }).run();
  }
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1">
      {btn('In đậm', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <Bold />)}
      {btn('In nghiêng', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic />)}
      {btn('Gạch chân', editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), <UnderlineIcon />)}
      {btn('Tiêu đề', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 />)}
      {btn('Danh sách', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), <List />)}
      {btn('Danh sách đánh số', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered />)}
      {btn('Trích dẫn', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), <Quote />)}
      {btn('Chèn liên kết', editor.isActive('link'), setLink, <Link2 />)}
      {editor.isActive('link') && btn('Gỡ liên kết', false, () => editor.chain().focus().unsetLink().run(), <Unlink />)}
      {btn('Nhắc tên đồng nghiệp (@)', false, () => editor.chain().focus().insertContent('@').run(), <AtSign />)}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Chèn emoji" title="Chèn emoji" onMouseDown={(e) => e.preventDefault()}><Smile /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="grid w-56 grid-cols-6 gap-0.5 p-1.5">
          {EMOJIS.map((e) => (
            <button key={e} type="button" className="rounded p-1 text-xl hover:bg-accent" onClick={() => editor.chain().focus().insertContent(e).run()}>{e}</button>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
