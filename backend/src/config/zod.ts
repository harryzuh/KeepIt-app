import { z } from 'zod';

// Mensagens de validação padrão em português (as mensagens específicas ficam nos schemas dos módulos).
z.config(z.locales.pt());
