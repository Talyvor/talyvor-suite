import { useMutation } from '@tanstack/react-query'
import { Button, Icon, showToast, type ButtonSize } from '@talyvor/ui/pocket'
import { saveFile } from './AgentBank'
import { agentBankApi, refusalText, type ListFile } from './agentBankApi'

/** B28.59 — what each list's file is called, and what the toast says it is. */
const LIST_FILES: Record<ListFile, { name: string; words: string }> = {
  approvals: { name: 'approvals.csv', words: 'the approvals' },
  schedules: { name: 'schedules.csv', words: 'every schedule' },
}

/** B28.59 — a list's Download CSV: the whole list as the CSV Lens writes for it, one row per item. B57.199: `sm` in a
 *  card header, as Pocket's Operator actions draws it; the page heading's keeps the regular size, as Statements does. */
export function ListFileDownload({ list, size }: { list: ListFile; size?: ButtonSize }) {
  const file = LIST_FILES[list]
  const save = useMutation({
    mutationFn: async () => saveFile(file.name, await agentBankApi.listFile(list)),
    onSuccess: () => showToast(`Downloading ${file.words} as a CSV file`),
  })
  return (
    <span className="inline-grid gap-1">
      <Button type="button" variant="secondary" size={size} icon={<Icon name="download" />} disabled={save.isPending} onClick={() => save.mutate()} data-testid={`${list}-csv`}>
        Download CSV
      </Button>
      {save.isError ? (
        <span role="alert" className="text-caption text-ink">
          {refusalText(save.error)}
        </span>
      ) : null}
    </span>
  )
}
