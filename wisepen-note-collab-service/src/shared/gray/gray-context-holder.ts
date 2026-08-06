import { config } from '../../config';
import { getGrayContext } from '../context/request-context-holder';

export function getCurrentDeveloper(): string | undefined {
  return getGrayContext()?.developer ?? config.developer.name;
}
