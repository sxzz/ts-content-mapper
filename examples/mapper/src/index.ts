import { MappedCodeBuilder, runContentMapper } from 'ts-content-mapper'

const openTag = '<script>'
const closeTag = '</script>'

runContentMapper({
  diagnosticSource: 'demo',
  transform({ content }) {
    const open = content.indexOf(openTag)
    const start = open === -1 ? -1 : open + openTag.length
    const end = start === -1 ? -1 : content.indexOf(closeTag, start)

    if (start === -1 || end === -1) {
      return {
        text: '',
        extension: '.ts',
        diagnostics: [
          {
            messageText: 'Expected a <script> block',
            start: 0,
            length: 0,
            code: 1,
          },
        ],
      }
    }

    return new MappedCodeBuilder(content)
      .appendVerbatim(start, end)
      .build('.ts')
  },
})
