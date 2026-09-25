> ## Documentation Index
> Fetch the complete documentation index at: https://docs.tavily.com/llms.txt
> Use this file to discover all available pages before exploring further.

# Tavily Map

> Tavily Map traverses websites like a graph and can explore hundreds of paths in parallel with intelligent discovery to generate comprehensive site maps.



## OpenAPI

````yaml POST /map
openapi: 3.0.3
info:
  title: Tavily Search and Extract API
  description: >-
    Our REST API provides seamless access to Tavily Search, a powerful search
    engine for LLM agents, and Tavily Extract, an advanced web scraping solution
    optimized for LLMs.
  version: 1.0.0
servers:
  - url: https://api.tavily.com/
security: []
tags:
  - name: Search
  - name: Extract
  - name: Crawl
  - name: Map
  - name: Research
  - name: Usage
paths:
  /map:
    post:
      summary: Initiate a web mapping from a base URL
      description: >-
        Tavily Map traverses websites like a graph and can explore hundreds of
        paths in parallel with intelligent discovery to generate comprehensive
        site maps.
      requestBody:
        description: Parameters for the Tavily Map request.
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                url:
                  type: string
                  description: The root URL to begin the mapping.
                  example: docs.tavily.com
                instructions:
                  type: string
                  description: >-
                    Natural language instructions for the crawler. When
                    specified, the cost increases to 2 API credits per 10
                    successful pages instead of 1 API credit per 10 pages.
                  example: Find all pages about the Python SDK
                  default: null
                max_depth:
                  type: integer
                  description: >-
                    Max depth of the mapping. Defines how far from the base URL
                    the crawler can explore.
                  default: 1
                  minimum: 1
                  maximum: 5
                max_breadth:
                  type: integer
                  description: >-
                    Max number of links to follow per level of the tree (i.e.,
                    per page).
                  default: 20
                  minimum: 1
                  maximum: 500
                limit:
                  type: integer
                  description: >-
                    Total number of links the crawler will process before
                    stopping.
                  default: 50
                  minimum: 1
                select_paths:
                  type: array
                  description: >-
                    Regex patterns to select only URLs with specific path
                    patterns (e.g., `/docs/.*`, `/api/v1.*`).
                  items:
                    type: string
                  default: null
                select_domains:
                  type: array
                  description: >-
                    Regex patterns to select crawling to specific domains or
                    subdomains (e.g., `^docs\.example\.com$`).
                  items:
                    type: string
                  default: null
                exclude_paths:
                  type: array
                  description: >-
                    Regex patterns to exclude URLs with specific path patterns
                    (e.g., `/private/.*`, `/admin/.*`).
                  items:
                    type: string
                  default: null
                exclude_domains:
                  type: array
                  description: >-
                    Regex patterns to exclude specific domains or subdomains
                    from crawling (e.g., `^private\.example\.com$`).
                  items:
                    type: string
                  default: null
                allow_external:
                  type: boolean
                  description: >-
                    Whether to include external domain links in the final
                    results list.
                  default: true
                timeout:
                  type: number
                  format: float
                  description: >-
                    Maximum time in seconds to wait for the map operation before
                    timing out. Must be between 10 and 150 seconds.
                  minimum: 10
                  maximum: 150
                  default: 150
                include_usage:
                  type: boolean
                  description: >-
                    Whether to include credit usage information in the
                    response.`NOTE:`The value may be 0 if the total successful
                    pages mapped has not yet reached 10 calls. See our [Credits
                    & Pricing
                    documentation](https://docs.tavily.com/documentation/api-credits)
                    for details.
                  default: false
              required:
                - url
      responses:
        '200':
          description: Map results returned successfully
          content:
            application/json:
              schema:
                type: object
                properties:
                  base_url:
                    type: string
                    description: The base URL that was mapped.
                    example: docs.tavily.com
                  results:
                    type: array
                    description: A list of URLs that were discovered during the mapping.
                    items:
                      type: string
                      example: docs.tavily.com
                    example:
                      - https://docs.tavily.com/welcome
                      - https://docs.tavily.com/documentation/api-credits
                      - https://docs.tavily.com/documentation/about
                  response_time:
                    type: number
                    format: float
                    description: Time in seconds it took to complete the request.
                    example: 1.23
                  usage:
                    type: object
                    description: Credit usage details for the request.
                    example:
                      credits: 1
                  request_id:
                    type: string
                    description: >-
                      A unique request identifier you can share with customer
                      support to help resolve issues with specific requests.
                    example: 123e4567-e89b-12d3-a456-426614174111
        '400':
          description: Bad Request - Your request is invalid.
          content:
            application/json:
              schema:
                type: object
                properties:
                  detail:
                    type: object
                    properties:
                      error:
                        type: string
              example:
                detail:
                  error: '[400] No starting url provided'
        '401':
          description: Unauthorized - Your API key is wrong or missing.
          content:
            application/json:
              schema:
                type: object
                properties:
                  detail:
                    type: object
                    properties:
                      error:
                        type: string
              example:
                detail:
                  error: 'Unauthorized: missing or invalid API key.'
        '403':
          description: Forbidden - URL is not supported.
          content:
            application/json:
              schema:
                type: object
                properties:
                  detail:
                    type: object
                    properties:
                      error:
                        type: string
              example:
                detail:
                  error: '[403] URL is not supported'
        '429':
          description: Too many requests - Rate limit exceeded
          content:
            application/json:
              schema:
                type: object
                properties:
                  detail:
                    type: object
                    properties:
                      error:
                        type: string
              example:
                detail:
                  error: >-
                    Your request has been blocked due to excessive requests.
                    Please reduce rate of requests.
        '432':
          description: Key limit or Plan Limit exceeded
          content:
            application/json:
              schema:
                type: object
                properties:
                  detail:
                    type: object
                    properties:
                      error:
                        type: string
              example:
                detail:
                  error: >-
                    This request exceeds your plan's set usage limit. Please
                    upgrade your plan or contact support@tavily.com
        '433':
          description: PayGo limit exceeded
          content:
            application/json:
              schema:
                type: object
                properties:
                  detail:
                    type: object
                    properties:
                      error:
                        type: string
              example:
                detail:
                  error: >-
                    This request exceeds the pay-as-you-go limit. You can
                    increase your limit on the Tavily dashboard.
        '500':
          description: Internal Server Error - We had a problem with our server.
          content:
            application/json:
              schema:
                type: object
                properties:
                  detail:
                    type: object
                    properties:
                      error:
                        type: string
              example:
                detail:
                  error: '[500] Internal server error'
      security:
        - bearerAuth: []
      x-codeSamples:
        - lang: python
          label: Python SDK
          source: |-
            from tavily import TavilyClient

            tavily_client = TavilyClient(api_key="tvly-YOUR_API_KEY")
            response = tavily_client.map("https://docs.tavily.com")

            print(response)
        - lang: javascript
          label: JavaScript SDK
          source: |-
            const { tavily } = require("@tavily/core");

            const tvly = tavily({ apiKey: "tvly-YOUR_API_KEY" });
            const response = await tvly.map("https://docs.tavily.com");

            console.log(response);
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: >-
        Bearer authentication header in the form Bearer <token>, where <token>
        is your Tavily API key (e.g., Bearer tvly-YOUR_API_KEY).

````