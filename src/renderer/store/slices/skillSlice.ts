import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { Skill } from '../../types/skill';

interface SkillState {
  skills: Skill[];
}

const initialState: SkillState = {
  skills: [],
};

const skillSlice = createSlice({
  name: 'skill',
  initialState,
  reducers: {
    setSkills: (state, action: PayloadAction<Skill[]>) => {
      state.skills = action.payload;
    },
    addSkill: (state, action: PayloadAction<Skill>) => {
      state.skills.push(action.payload);
    },
    updateSkill: (state, action: PayloadAction<{ id: string; updates: Partial<Skill> }>) => {
      const index = state.skills.findIndex(s => s.id === action.payload.id);
      if (index !== -1) {
        state.skills[index] = { ...state.skills[index], ...action.payload.updates };
      }
    },
    deleteSkill: (state, action: PayloadAction<string>) => {
      state.skills = state.skills.filter(s => s.id !== action.payload);
    },
    toggleSkill: (state, action: PayloadAction<string>) => {
      const skill = state.skills.find(s => s.id === action.payload);
      if (skill) {
        skill.enabled = !skill.enabled;
      }
    },
  },
});

export const {
  setSkills,
  addSkill,
  updateSkill,
  deleteSkill,
  toggleSkill,
} = skillSlice.actions;

export default skillSlice.reducer;
