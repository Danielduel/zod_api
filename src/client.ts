import { StatusCode } from "./utils/status_codes.ts"
import type {
  ApiActionConfig,
  ApiBodyfullActionConfig,
  ApiBodylessActionConfig,
  ApiClient,
  ApiClientAction,
  ApiClientActionMethod,
  ApiClientActions,
  ApiClientBodyfullActionMethod,
  ApiClientBodylessActionMethod,
  ApiClientConfig,
  ApiResourceConfig,
  ApiResponse,
  BodyType,
  Fetcher,
  Path,
  PathlessApiResourceConfig,
  PossibleApiClientAction,
  PossibleApiClientActionParams,
} from "./types.ts"

/* == API CREATION FUNCTIONS == */

export function zodApiClient<
  const T1 extends Fetcher,
  const T2 extends ApiClientConfig<T1>,
>(
  config: T2,
): ApiClient<T2> {
  const apiClient = Object.fromEntries(
    Object.entries(config.resources).map(([key, resourceConfig]) => [
      key,
      createApiClientActions(resourceConfig, config),
    ]),
  )

  return apiClient as ApiClient<T2>
}

export function zodApiResource<
  const T1 extends Path,
  const T2 extends PathlessApiResourceConfig<T1>,
  const T3 extends ApiResourceConfig<T1, T2> = ApiResourceConfig<T1, T2>,
>(
  path: T1,
  config: T2,
) {
  return {
    path,
    ...config,
  } as T3
}

function createApiClientActions<
  const T1 extends ApiResourceConfig<Path, PathlessApiResourceConfig<Path>>,
  const T2 extends ApiClientConfig<Fetcher>,
>(
  resourceConfig: T1,
  apiConfig: T2,
): ApiClientActions<T1["actions"], T1, T2> {
  const actions = Object.fromEntries(
    Object.entries(resourceConfig.actions)
      .map(([key, actionConfig]) => [
        key,
        key === "get"
          ? createClientBodylessAction(
            "GET",
            actionConfig as ApiBodylessActionConfig,
            resourceConfig,
            apiConfig,
          )
          : key === "post"
          ? createClientBodyfullAction(
            "POST",
            actionConfig as ApiBodyfullActionConfig,
            resourceConfig,
            apiConfig,
          )
          : null,
      ])
      .filter(([_, action]) => !!action),
  )

  return actions as ApiClientActions<T1["actions"], T1, T2>
}

function createClientBodylessAction<
  const T1 extends ApiBodylessActionConfig,
  const T2 extends ApiResourceConfig<Path, PathlessApiResourceConfig<Path>>,
  const T3 extends ApiClientConfig<Fetcher>,
>(
  method: ApiClientBodylessActionMethod,
  actionConfig: T1,
  resourceConfig: T2,
  apiConfig: T3,
): ApiClientAction<T1, T2, T3> {
  // Create complete url
  const url = apiConfig.baseUrl + resourceConfig.path

  // Create handler function
  const handler: PossibleApiClientAction = (params) => {
    return sendRequest(
      urlWithParams(url, params),
      method,
      actionConfig,
      apiConfig,
      createRequestParams(apiConfig, params),
    )
  }

  // Return handler function as typed api client action
  return handler as ApiClientAction<T1, T2, T3>
}

function createClientBodyfullAction<
  const T1 extends ApiBodyfullActionConfig,
  const T2 extends ApiResourceConfig<Path, PathlessApiResourceConfig<Path>>,
  const T3 extends ApiClientConfig<Fetcher>,
>(
  method: ApiClientBodyfullActionMethod,
  actionConfig: T1,
  resourceConfig: T2,
  apiConfig: T3,
): ApiClientAction<T1, T2, T3> {
  // Collect resource objects/options
  const url = apiConfig.baseUrl + resourceConfig.path

  // Create handler function
  const handler: PossibleApiClientAction = (params) => {
    return sendRequest(
      urlWithParams(url, params),
      method,
      actionConfig,
      apiConfig,
      {
        ...createRequestParams(apiConfig, params),
        body: createBody(params?.body, actionConfig.bodyType),
      },
    )
  }

  return handler as ApiClientAction<T1, T2, T3>
}

async function sendRequest<const T extends ApiActionConfig>(
  url: string,
  method: ApiClientActionMethod,
  actionConfig: T,
  apiConfig: ApiClientConfig<Fetcher>,
  init?: RequestInit,
): Promise<ApiResponse<T>> {
  try {
    // Log fetch event
    apiConfig.logger?.debug(`Fetching: ${url}`)

    // Set fetcher
    const fetcher = apiConfig.fetcher ?? fetch

    // Send request using fetch
    const res = await fetcher(url, {
      ...init,
      method,
    })

    if (!res.ok) {
      // Log HTTP error
      apiConfig.logger?.error(
        `Error fetching: ${url}, Status: ${res.status} ${res.statusText}`,
      )

      // Return error response
      return {
        ok: false,
        data: null,
        status: res.status,
        statusText: res.statusText,
      }
    }

    // If no data schema, return successful response without data
    if (!actionConfig.dataSchema) {
      return {
        ok: true,
        data: null,
        status: res.status,
        statusText: res.statusText,
      }
    }

    // Get and parse data
    const dataType = actionConfig.dataType ?? "JSON"

    // Log data get event
    apiConfig.logger?.debug(`Getting data of type: ${dataType}`)

    // Get data from response
    const json = actionConfig.dataType === "Text"
      ? await res.text()
      : await res.json()

    // Log data parse event
    apiConfig.logger?.debug(`Parsing data of type: ${dataType}`)

    // Parse data
    const parsed = await actionConfig.dataSchema.safeParseAsync(json)

    // Handle failed parse
    if (!parsed.success) {
      // Log parse error
      apiConfig.logger?.error(
        `Error when parsing data of type: ${dataType}
        ${JSON.stringify(parsed.error, null, 2)}`,
      )

      // return response with custom error status
      return {
        ok: false,
        data: null,
        status: StatusCode.DataParseError,
        statusText: "Data not parsed successfully",
      }
    }

    // Return successful response with parsed data
    return {
      ok: true,
      data: parsed.data,
      status: res.status,
      statusText: res.statusText,
    }
  } catch (e) {
    // Log error
    apiConfig.logger?.error(e)

    // Return response with custom error status
    return {
      ok: false,
      data: null,
      status: StatusCode.UncaughtClientError,
      statusText: "Unhandled client-side error",
    }
  }
}

/* == UTILITY FUNCTIONS == */

function urlWithParams(
  url: string,
  params?: PossibleApiClientActionParams,
) {
  // Get param entries
  const urlParamEntries = Object.entries(params?.urlParams ?? {})
  const searchParamEntries = Object.entries(params?.searchParams ?? {})

  // Create mutable url
  let mutableUrl = url

  // Add url parameters to URL
  for (const [param, value] of urlParamEntries) {
    mutableUrl = mutableUrl.replace(`:${param}`, `${value}`)
  }

  // Add search parameters to URL
  if (searchParamEntries.length > 0) {
    mutableUrl += "?"
    for (const [param, value] of searchParamEntries) {
      mutableUrl += `${param}=${value}&`
    }
    mutableUrl = mutableUrl.substring(0, mutableUrl.length - 1)
  }

  // Return modified url
  return mutableUrl
}

function createRequestParams(
  apiConfig: ApiClientConfig<Fetcher>,
  params?: PossibleApiClientActionParams,
): RequestInit {
  // Stringify param headers
  const paramHeaderEntries = Object.entries(params?.headers ?? {})

  const stringifiedParamHeaderEntries = paramHeaderEntries.map((
    [key, value],
  ) => [key, `${value}`])

  const paramHeaders = Object.fromEntries(stringifiedParamHeaderEntries)

  // Merge in increasing priority
  return {
    ...apiConfig.defaultRequestParams,
    ...params?.requestParams,
    headers: {
      ...apiConfig.defaultRequestParams?.headers,
      ...paramHeaders,
    },
  }
}

function createBody(
  bodyParams?: Record<string, unknown>,
  bodyType: BodyType = "JSON",
) {
  if (!bodyParams) {
    return undefined
  }

  if (bodyType === "JSON") {
    return JSON.stringify(bodyParams)
  }

  const urlSearchParams = new URLSearchParams()

  Object.entries(bodyParams).forEach(([key, value]) =>
    urlSearchParams.append(key, `${value}`)
  )

  return urlSearchParams
}
