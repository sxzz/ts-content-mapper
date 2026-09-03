import { nodeLib } from 'tsdown-preset-sxzz'
import ApiSnapshot from 'tsnapi/rolldown'

export default nodeLib({}, { plugins: [ApiSnapshot()] })
