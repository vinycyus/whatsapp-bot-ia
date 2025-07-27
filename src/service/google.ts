import { GoogleGenerativeAI, type ChatSession } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_KEY!);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const activeChats = new Map<string, any>();

const getOrCreateChatSession = (chatId: string): ChatSession => {
  console.log('activeChats.has(chatId)', activeChats.has(chatId));

  if (activeChats.has(chatId)) {
    const currentHistory = activeChats.get(chatId);
    console.log({ currentHistory, chatId });
    return model.startChat({ history: currentHistory });
  }

  const history = [
    {
      role: 'user',
      parts: [
        {
          text: process.env.GEMINI_PROMPT ??
            'Olá! Seja bem-vindo(a) ao Assistente Virtual do Portal registro!',
        },
      ],
    },
    {
      role: 'model',
      parts: [
        {
          text: 'Olá, certo!',
        },
      ],
    },
  ];

  activeChats.set(chatId, history);
  return model.startChat({ history });
};

export const mainGoogle = async ({
  currentMessage,
  chatId,
}: {
  currentMessage: string;
  chatId: string;
}): Promise<string> => {
  const chat = getOrCreateChatSession(chatId);
  const result = await chat.sendMessage(currentMessage);
  const response = await result.response;
  const text = response.text();

  const history = activeChats.get(chatId) || [];
  history.push(
    {
      role: 'user',
      parts: [{ text: currentMessage }],
    },
    {
      role: 'model',
      parts: [{ text }],
    }
  );

  activeChats.set(chatId, history);

  console.log('Resposta Gemini: ', text);
  return text;
};

// 🛑 Nova função para parar o chat
export const stopChatSession = (chatId: string): void => {
  if (activeChats.has(chatId)) {
    activeChats.delete(chatId);
    console.log(`Chat com ID ${chatId} encerrado com sucesso.`);
  } else {
    console.log(`Nenhuma sessão ativa encontrada para o ID ${chatId}.`);
  }
};
