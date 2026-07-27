import { Platform } from 'react-native'

export const API_URL =
  Platform.OS === 'android'
    ? 'http://10.39.14.177:3000/api'
    : 'http://localhost:3000/api'
