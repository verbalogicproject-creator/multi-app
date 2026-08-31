export enum AiResponseStyle {
  REGULAR = 'Regular',
  CODER = 'Coder',
  CLARIFICATION = 'Clarification',
  THINK_DEEP = 'Think Deep',
  LEARN = 'Learn',
  INTUITIVE_GUESS = 'Intuitive Guess',
}

export interface CustomAiStyle {
  id: string;
  name: string;
  instructions: string;
  isDefault?: boolean;
}

export interface ComposedStyle {
  // Can be a default style name or a custom style ID/name
  name: string; 
  // Influence weight from 0 to 1
  weight: number; 
}

export interface Persona {
  id: string;
  name: string;
  baseInstructions: string;
  composedStyles: ComposedStyle[];
}

export interface Agent {
  id: string;
  name: string;
  personaId: string;
  projectId: string;
}

export interface DirectorControls {
    shotType: string;
    cameraMovement: string;
    style: string;
}
