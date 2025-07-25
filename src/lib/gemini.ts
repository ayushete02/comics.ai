//gemini.ts
import { GoogleGenAI, PersonGeneration } from "@google/genai";
import {
  Character,
  Chapter,
  ChatMessage,
  ChatCompletionRequest,
} from "./types";
import { NearAIHelper } from "./near-ai";
// import lighthouse from "@lighthouse-web3/sdk";
import {
  createImagePrompt,
  createComicStripPrompt,
  COMIC_STRIP_SYSTEM_PROMPT,
} from "@/constants/prompts";

// Check for required environment variables
if (!process.env.GEMINI_API_KEY) {
  throw new Error(
    "GEMINI_API_KEY environment variable is required for image generation"
  );
}

// Initialize Google AI client
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface ChapterImage {
  chapter_number: number;
  title: string;
  image: string; // Base64 image data
  comic_strip?: string; // Generated comic strip text
  chapterNumber?: number; // Optional for compatibility
}

/**
 * Uploads base64 image data to Lighthouse storage and returns the IPFS link
 */
// async function uploadToLighthouse(base64Data: string): Promise<string> {
//   try {
//     // Convert base64 to buffer
//     const imageBuffer = Buffer.from(base64Data, "base64");

//     // Upload buffer directly to Lighthouse
//     const uploadResponse = await lighthouse.uploadBuffer(
//       imageBuffer,
//       process.env.LIGHTHOUSE_API_KEY!
//     );

//     if (!uploadResponse.data?.Hash) {
//       throw new Error("Failed to get IPFS hash from Lighthouse response");
//     }

//     // Return the IPFS gateway URL with filename
//     const ipfsHash = uploadResponse.data.Hash;
//     return `https://gateway.lighthouse.storage/ipfs/${ipfsHash}`;
//   } catch (error) {
//     console.error("Error uploading to Lighthouse:", error);
//     throw new Error(
//       `Failed to upload image to Lighthouse: ${error instanceof Error ? error.message : "Unknown error"
//       }`
//     );
//   }
// }

/**
 * Generates a comic strip for a chapter using Near AI
 */
async function generateComicStrip(
  chapter: Chapter,
  characters: Character[]
): Promise<string> {
  try {
    const prompt = createComicStripPrompt(chapter, characters);

    console.log(
      `Generating comic strip for Chapter ${chapter.chapter_number}: ${chapter.title}`
    );

    // Prepare Near AI request
    const chatRequest: ChatCompletionRequest = {
      messages: [
        {
          role: "system",
          content: COMIC_STRIP_SYSTEM_PROMPT,
        } as ChatMessage,
        {
          role: "user",
          content: prompt,
        } as ChatMessage,
      ],
    };

    // Generate comic strip using Near AI
    let comicStripContent = "";
    for await (const chunk of NearAIHelper.generateCompletionStream(
      chatRequest
    )) {
      comicStripContent += chunk;
    }

    if (!comicStripContent.trim()) {
      throw new Error("Failed to generate comic strip content from Near AI");
    }

    console.log("Generated comic strip content:", comicStripContent);

    return comicStripContent;
  } catch (error) {
    console.error(
      `Error generating comic strip for chapter ${chapter.chapter_number}:`,
      error
    );
    throw new Error(
      `Failed to generate comic strip for chapter ${chapter.chapter_number}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Generates a single image for a chapter using Gemini Imagen
 */
export async function generateChapterImage(
  chapter: Chapter,
  characters: Character[]
): Promise<ChapterImage> {
  try {
    // First generate the comic strip
    const comicStrip = await generateComicStrip(chapter, characters);

    // Then create the image prompt using the comic strip
    const prompt = createImagePrompt(chapter, characters, comicStrip);

    console.log(
      `Generating image for Chapter ${chapter.chapter_number}: ${chapter.title}`
    );

    const response = await genAI.models.generateImages({
      model: "imagen-3.0-generate-002",
      prompt: prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: "9:16", // Good for comic panels
        personGeneration: PersonGeneration.ALLOW_ADULT, // Allow adult characters
      },
    });

    if (!response.generatedImages || response.generatedImages.length === 0) {
      throw new Error("No images generated");
    }

    const generatedImage = response.generatedImages[0];
    if (!generatedImage.image) {
      throw new Error("Generated image does not contain image data");
    }

    const imageBytes = generatedImage.image.imageBytes;
    if (!imageBytes) {
      throw new Error("Generated image does not contain image bytes");
    }

    // const lighthouseUrl = await uploadToLighthouse(imageBytes);

    return {
      chapter_number: chapter.chapter_number,
      title: chapter.title,
      image: imageBytes, // Base64 image data
      comic_strip: comicStrip,
    };
  } catch (error) {
    console.error(
      `Error generating image for chapter ${chapter.chapter_number}:`,
      error
    );
    throw new Error(
      `Failed to generate image for chapter ${chapter.chapter_number}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Generates images for all chapters in a story
 */
export async function generateStoryImages(
  chapters: Chapter[],
  characters: Character[]
): Promise<ChapterImage[]> {
  console.log(
    `Starting to generate ${chapters.length} chapter images with comic strips...`
  );

  // Sort chapters by chapter_number to ensure sequential order
  const sortedChapters = [...chapters].sort(
    (a, b) => a.chapter_number - b.chapter_number
  );

  // Generate all images in parallel using Promise.all
  const imagePromises = sortedChapters.map(async (chapter) => {
    try {
      return await generateChapterImage(chapter, characters);
    } catch (error) {
      console.error(
        `Failed to generate image for chapter ${chapter.chapter_number}:`,
        error
      );
      // Return fallback object for failed chapters
      return {
        chapter_number: chapter.chapter_number,
        title: chapter.title,
        image: "", // Empty string indicates failure
        comic_strip: "",
      };
    }
  });

  // Wait for all images to be generated (Promise.all preserves order)
  const chapterImages = await Promise.all(imagePromises);

  // Double-check sequential ordering
  const sequentialChapterImages = chapterImages.sort(
    (a, b) => a.chapter_number - b.chapter_number
  );

  console.log(
    `Completed generating ${sequentialChapterImages.length} chapter images with comic strips`
  );
  return sequentialChapterImages;
}
