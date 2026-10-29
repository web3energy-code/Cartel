// Phone photos are huge. Shrink to a JPEG so uploads are quick and fit the server limit.
export function shrink(file: File, maxSize = 1280): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()

    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')

      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not read that photo.'))), 'image/jpeg', 0.82)
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file is not a photo we can read.'))
    }

    img.src = url
  })
}
