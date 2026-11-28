export interface StudioImage {
  id: string
  prompt: string
  modelId: string
  createdAt: number
  image: Blob
  fallbackModelId?: string
}

async function openLibrary(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pi-harness-image-library', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('images', { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function libraryRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openLibrary()
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('images', mode)
      const request = run(transaction.objectStore('images'))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onabort = () => reject(transaction.error ?? request.error)
    })
  } finally {
    db.close()
  }
}

export const readImageLibrary = () =>
  libraryRequest<StudioImage[]>('readonly', (store) => store.getAll())

export const writeStudioImage = (work: StudioImage) =>
  libraryRequest('readwrite', (store) => store.put(work))

export const removeStudioImage = (id: string) =>
  libraryRequest('readwrite', (store) => store.delete(id))
