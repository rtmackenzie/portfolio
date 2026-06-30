import { jsPDF } from 'jspdf'
import html2canvas from 'html2canvas-pro'

// Rasterise a DOM element and save it as a single-page A4 PDF.
// html2canvas-pro (not classic html2canvas) is required because Tailwind v4's
// theme tokens use oklch(), which the classic library cannot parse.
export async function exportElementToPdf(el: HTMLElement, filename: string): Promise<void> {
  const canvas = await html2canvas(el, { scale: 2, backgroundColor: '#ffffff', useCORS: true })

  const doc = new jsPDF('p', 'mm', 'a4')
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 10
  const maxW = pageW - margin * 2
  const maxH = pageH - margin * 2

  // Fit within the A4 content box (both dimensions) so it stays one page.
  const ratio = Math.min(maxW / canvas.width, maxH / canvas.height)
  const w = canvas.width * ratio
  const h = canvas.height * ratio
  const x = (pageW - w) / 2
  const y = margin

  doc.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, w, h)
  doc.save(filename)
}

// Rasterise a (potentially tall) element across multiple A4 pages. Used for the
// Business Overview report. `forceLight` temporarily applies the `.light` theme
// class so the capture is ink-friendly regardless of the app's dark theme.
export async function exportElementToPdfPaged(
  el: HTMLElement,
  filename: string,
  opts?: { forceLight?: boolean }
): Promise<void> {
  const addedLight = !!opts?.forceLight && !el.classList.contains('light')
  if (addedLight) el.classList.add('light')

  // Matches the light theme's --color-background so white cards/panels stand out.
  const BG: [number, number, number] = [248, 249, 251]

  try {
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: `rgb(${BG.join(',')})`, useCORS: true })

    const doc = new jsPDF('p', 'mm', 'a4')
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const margin = 10
    const imgW = pageW - margin * 2
    const imgH = (canvas.height * imgW) / canvas.width   // full image height in mm
    const contentH = pageH - margin * 2

    const fillPage = () => { doc.setFillColor(...BG); doc.rect(0, 0, pageW, pageH, 'F') }

    const img = canvas.toDataURL('image/png')
    let heightLeft = imgH
    let position = margin

    fillPage()
    doc.addImage(img, 'PNG', margin, position, imgW, imgH)
    heightLeft -= contentH

    while (heightLeft > 0) {
      doc.addPage()
      fillPage()
      position = margin - (imgH - heightLeft)   // shift the image up by one page
      doc.addImage(img, 'PNG', margin, position, imgW, imgH)
      heightLeft -= contentH
    }

    doc.save(filename)
  } finally {
    if (addedLight) el.classList.remove('light')
  }
}
