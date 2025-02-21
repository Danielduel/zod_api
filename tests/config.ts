import { z } from "zod"
import { zodApiClient, zodApiResource } from "../mod.ts"

type Init = Required<Parameters<typeof fetch>>["1"] & {
  test?: string
}

const fetcher = (input: string | URL | Request, init?: Init) =>
  fetch(input, init)

export const pokemonApiClient = zodApiClient({
  fetcher,
  logger: console,
  baseUrl: "https://pokeapi.co/api/v2/",
  resources: {
    pokemon: zodApiResource("/pokemon/:name", {
      urlParamsSchema: z.object({
        name: z.string(),
      }),
      actions: {
        get: {
          dataSchema: z.object({
            id: z.number(),
            name: z.string(),
          }),
          headersSchema: z.object({
            "schema-header": z.string(),
          }),
        },
      },
    }),
  },
  defaultRequestParams: {
    headers: {
      "default-header": "default-header",
    },
  },
})
