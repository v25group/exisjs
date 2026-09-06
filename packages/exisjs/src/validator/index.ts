import { TexEngine } from './tex'
export type Infer<T> = T extends TexEngine<infer U> ? U : never
export { tex } from './tex'
