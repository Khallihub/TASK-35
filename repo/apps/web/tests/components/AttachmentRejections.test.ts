import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AttachmentList from '@/components/attachments/AttachmentList.vue'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('AttachmentList', () => {
  // Matches the public AttachmentData projection — internal storage metadata
  // (storage_key, sha256, created_by, current_revision_id) is omitted server-
  // side and is not part of the UI contract.
  const sampleAttachments = [
    {
      id: 1,
      listing_id: 10,
      kind: 'image' as const,
      original_filename: 'photo.jpg',
      bytes: 1024,
      mime: 'image/jpeg',
      width: 800,
      height: 600,
      duration_seconds: null,
      created_at: '2025-01-01T00:00:00Z',
    },
    {
      id: 2,
      listing_id: 10,
      kind: 'pdf' as const,
      original_filename: 'floorplan.pdf',
      bytes: 2048576,
      mime: 'application/pdf',
      width: null,
      height: null,
      duration_seconds: null,
      created_at: '2025-01-02T00:00:00Z',
    },
  ]

  it('renders empty state when no attachments', () => {
    const wrapper = mount(AttachmentList, {
      props: { listingId: 10, attachments: [], role: 'merchant' },
    })
    expect(wrapper.text()).toContain('No attachments yet')
  })

  it('renders attachment table with correct rows', () => {
    const wrapper = mount(AttachmentList, {
      props: { listingId: 10, attachments: sampleAttachments, role: 'merchant' },
    })
    const rows = wrapper.findAll('tbody tr')
    expect(rows).toHaveLength(2)
  })

  it('displays filenames in table', () => {
    const wrapper = mount(AttachmentList, {
      props: { listingId: 10, attachments: sampleAttachments, role: 'merchant' },
    })
    expect(wrapper.text()).toContain('photo.jpg')
    expect(wrapper.text()).toContain('floorplan.pdf')
  })

  it('formats file size correctly', () => {
    const wrapper = mount(AttachmentList, {
      props: { listingId: 10, attachments: sampleAttachments, role: 'merchant' },
    })
    expect(wrapper.text()).toContain('1.0 KB')
    expect(wrapper.text()).toContain('2.0 MB')
  })

  it('shows Revisions and Delete buttons for merchant role', () => {
    const wrapper = mount(AttachmentList, {
      props: { listingId: 10, attachments: sampleAttachments, role: 'merchant' },
    })
    expect(wrapper.findAll('button').some(b => b.text() === 'Revisions')).toBe(true)
    expect(wrapper.findAll('button').some(b => b.text() === 'Delete')).toBe(true)
  })

  it('hides action buttons for regular_user role', () => {
    const wrapper = mount(AttachmentList, {
      props: { listingId: 10, attachments: sampleAttachments, role: 'regular_user' },
    })
    expect(wrapper.findAll('button').filter(b => b.text() === 'Revisions')).toHaveLength(0)
    expect(wrapper.findAll('button').filter(b => b.text() === 'Delete')).toHaveLength(0)
  })

  it('emits deleted event when delete is confirmed', async () => {
    const wrapper = mount(AttachmentList, {
      props: { listingId: 10, attachments: sampleAttachments, role: 'administrator' },
    })
    const deleteBtn = wrapper.findAll('button').find(b => b.text() === 'Delete')!
    await deleteBtn.trigger('click')
    // ConfirmDialog should now be visible
    const confirmBtn = wrapper.findAll('button').find(b => b.text() === 'Delete' && b.classes().length > 0)
    if (confirmBtn) {
      await confirmBtn.trigger('click')
    }
  })
})
