import { callChatCompletions } from '~~/server/utils/aiGateway'

/**
 * Generate a concise title for a conversation based on the first user message
 *
 * Similar to ChatGPT's approach: analyzes the first message and creates a 3-6 word title
 * that captures the conversation's intent.
 *
 * @param firstMessage - The first user message in the conversation
 * @returns A concise title (typically 3-6 words)
 */
export async function generateConversationTitle(firstMessage: string): Promise<string> {
  const systemPrompt = `You are a helpful assistant that generates concise, descriptive titles for conversations.

Rules:
- Generate a title that is 3-6 words long
- The title should capture the main intent or topic of the conversation
- Use title case (capitalize important words)
- Be specific but concise
- Do not include quotes or special formatting
- Return ONLY the title, nothing else

Examples:
- "Create a blog post about productivity" → "Productivity Blog Post"
- "Help me write content from this YouTube video" → "YouTube Content Creation"
- "Update the introduction section" → "Update Introduction Section"
- "What's the best way to structure an article?" → "Article Structure Advice"`

  const userPrompt = `Generate a concise title for this conversation based on the first message:

"${firstMessage.slice(0, 500)}"

Title:`

  try {
    const title = await callChatCompletions({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      maxTokens: 20 // Titles should be short
    })

    // Clean up the title
    const cleaned = title.trim()
      .replace(/^["']|["']$/g, '') // Remove surrounding quotes
      .replace(/\n+/g, ' ') // Replace newlines with spaces
      .trim()

    // Fallback if title is too long or empty
    if (!cleaned || cleaned.length > 60) {
      // Fallback: use first few words of the message
      const words = firstMessage.trim().split(/\s+/).slice(0, 6).join(' ')
      return words.length > 60 ? `${words.slice(0, 57)}...` : words
    }

    return cleaned
  } catch (error) {
    console.error('[generateConversationTitle] Failed to generate title:', error)
    // Fallback: use first few words of the message
    const words = firstMessage.trim().split(/\s+/).slice(0, 6).join(' ')
    return words.length > 60 ? `${words.slice(0, 57)}...` : words
  }
}

/**
 * Get the conversation title from metadata or generate a fallback
 *
 * @param conversation - The conversation record
 * @param conversation.metadata - Optional metadata object containing the title
 * @param firstArtifactTitle - Optional title from associated content
 * @returns The conversation title
 */
export function getConversationTitle(
  conversation: { metadata?: Record<string, any> | null },
  firstArtifactTitle?: string | null
): string {
  // Priority: metadata.title > firstArtifactTitle > "Untitled conversation"
  const metadataTitle = conversation.metadata?.title
  if (metadataTitle && typeof metadataTitle === 'string' && metadataTitle.trim()) {
    return metadataTitle.trim()
  }

  if (firstArtifactTitle && firstArtifactTitle.trim()) {
    return firstArtifactTitle.trim()
  }

  return 'Untitled conversation'
}
